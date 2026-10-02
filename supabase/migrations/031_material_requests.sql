-- Operaciones: solicitudes de materiales y salida fisica desde almacen.

-- Permisos de modulo. El backfill conserva permisos y elimina duplicados.
ALTER TABLE public.user_profiles
    DROP CONSTRAINT user_profiles_module_permissions_check;

ALTER TABLE public.user_profiles
    ADD CONSTRAINT user_profiles_module_permissions_check
    CHECK (module_permissions <@ ARRAY[
        'dashboard', 'plants', 'devices', 'maintenance', 'inventory', 'reports', 'operations'
    ]);

UPDATE public.user_profiles AS profile
SET module_permissions = ARRAY(
    SELECT DISTINCT permission
    FROM unnest(profile.module_permissions || ARRAY['operations']::text[]) AS permission
    ORDER BY permission
),
    updated_at = now()
WHERE profile.role IN ('client_admin', 'client_user')
  AND NOT (profile.module_permissions @> ARRAY['operations']::text[]);

-- Nuevos estados de inventario, sin transformar historial existente.
ALTER TABLE public.inventory_items
    DROP CONSTRAINT inventory_items_status_check;
ALTER TABLE public.inventory_items
    ADD CONSTRAINT inventory_items_status_check
    CHECK (status IN ('available', 'dispatched', 'assigned', 'installed', 'sold', 'written_off'));

ALTER TABLE public.inventory_movements
    DROP CONSTRAINT inventory_movements_movement_type_check;
ALTER TABLE public.inventory_movements
    ADD CONSTRAINT inventory_movements_movement_type_check
    CHECK (movement_type IN (
        'in', 'dispatch', 'assign', 'install', 'sell', 'return', 'write_off',
        'adjust_in', 'adjust_out'
    ));

CREATE TABLE public.material_request_code_counters (
    year integer PRIMARY KEY,
    last_value integer NOT NULL
        CONSTRAINT material_request_code_counters_value_check
        CHECK (last_value BETWEEN 1 AND 9999)
);

CREATE OR REPLACE FUNCTION public.next_material_request_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    v_year integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
    v_value integer;
BEGIN
    INSERT INTO public.material_request_code_counters AS counter (year, last_value)
    VALUES (v_year, 1)
    ON CONFLICT (year) DO UPDATE
    SET last_value = counter.last_value + 1
    WHERE counter.last_value < 9999
    RETURNING last_value INTO v_value;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'MATERIAL_REQUEST_CODE_LIMIT_REACHED';
    END IF;

    RETURN 'MAT-' || pg_catalog.lpad(v_year::text, 4, '0') || '-'
        || pg_catalog.lpad(v_value::text, 4, '0');
END;
$$;

CREATE TABLE public.material_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE
        CONSTRAINT material_requests_code_format_check
        CHECK (code ~ '^MAT-[0-9]{4}-[0-9]{4}$'),
    requested_by uuid NOT NULL
        REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    plant_id uuid REFERENCES public.plants(id) ON DELETE RESTRICT,
    maintenance_visit_id uuid
        REFERENCES public.maintenance_visits(id) ON DELETE RESTRICT,
    reason text NOT NULL
        CONSTRAINT material_requests_reason_check
        CHECK (reason IN ('installation', 'maintenance', 'warranty', 'replacement', 'internal', 'other')),
    priority text NOT NULL DEFAULT 'normal'
        CONSTRAINT material_requests_priority_check
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status text NOT NULL DEFAULT 'requested'
        CONSTRAINT material_requests_status_check
        CHECK (status IN ('requested', 'received', 'preparing', 'ready', 'delivered', 'rejected', 'cancelled')),
    destination text,
    required_at timestamptz,
    observations text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.protect_material_request_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    v_table_owner name;
BEGIN
    SELECT role.rolname
    INTO v_table_owner
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_roles AS role ON role.oid = relation.relowner
    WHERE relation.oid = TG_RELID;

    IF pg_catalog.current_setting('app.material_request_status_rpc', true)
            IS DISTINCT FROM 'authorized'
        OR CURRENT_USER IS DISTINCT FROM v_table_owner THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'MATERIAL_REQUEST_STATUS_UPDATE_REQUIRES_RPC';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER material_requests_status_update_guard
BEFORE UPDATE OF status ON public.material_requests
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.protect_material_request_status();

CREATE TABLE public.material_request_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL
        REFERENCES public.material_requests(id) ON DELETE CASCADE,
    product_id uuid NOT NULL
        REFERENCES public.inventory_products(id) ON DELETE RESTRICT,
    requested_quantity numeric NOT NULL
        CONSTRAINT material_request_lines_requested_quantity_check
        CHECK (requested_quantity > 0),
    prepared_quantity numeric NOT NULL DEFAULT 0,
    delivered_quantity numeric NOT NULL DEFAULT 0,
    observations text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT material_request_lines_prepared_quantity_check
        CHECK (prepared_quantity >= 0),
    CONSTRAINT material_request_lines_delivered_quantity_check
        CHECK (delivered_quantity >= 0),
    CONSTRAINT material_request_lines_prepared_requested_check
        CHECK (prepared_quantity <= requested_quantity),
    CONSTRAINT material_request_lines_delivered_prepared_check
        CHECK (delivered_quantity <= prepared_quantity),
    CONSTRAINT material_request_lines_request_product_key
        UNIQUE (request_id, product_id)
);

CREATE TABLE public.material_request_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_line_id uuid NOT NULL
        REFERENCES public.material_request_lines(id) ON DELETE CASCADE,
    inventory_item_id uuid NOT NULL
        REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
    prepared_by uuid NOT NULL
        REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    prepared_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz,
    released_at timestamptz,
    CONSTRAINT material_request_items_line_item_key
        UNIQUE (request_line_id, inventory_item_id),
    CONSTRAINT material_request_items_terminal_state_check
        CHECK (delivered_at IS NULL OR released_at IS NULL)
);

CREATE UNIQUE INDEX material_request_items_active_item_key
    ON public.material_request_items (inventory_item_id)
    WHERE delivered_at IS NULL AND released_at IS NULL;

CREATE TABLE public.material_request_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL
        REFERENCES public.material_requests(id) ON DELETE CASCADE,
    event_type text NOT NULL
        CONSTRAINT material_request_events_type_check
        CHECK (event_type IN (
            'requested', 'received', 'preparing_started', 'item_prepared',
            'preparation_updated', 'ready', 'delivered', 'rejected', 'cancelled'
        )),
    actor_id uuid NOT NULL
        REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX material_request_events_idempotency_key
    ON public.material_request_events (request_id, event_type, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX material_requests_status_idx ON public.material_requests (status);
CREATE INDEX material_requests_requested_by_idx ON public.material_requests (requested_by);
CREATE INDEX material_requests_plant_id_idx ON public.material_requests (plant_id);
CREATE INDEX material_requests_maintenance_visit_id_idx ON public.material_requests (maintenance_visit_id);
CREATE INDEX material_requests_required_at_idx ON public.material_requests (required_at);
CREATE INDEX material_request_lines_request_id_idx ON public.material_request_lines (request_id);
CREATE INDEX material_request_items_request_line_id_idx ON public.material_request_items (request_line_id);
CREATE INDEX material_request_events_request_created_idx
    ON public.material_request_events (request_id, created_at);

-- Las referencias se agregan despues de crear request y line para evitar ciclo DDL.
ALTER TABLE public.inventory_movements
    ADD COLUMN material_request_id uuid
        REFERENCES public.material_requests(id) ON DELETE RESTRICT,
    ADD COLUMN material_request_line_id uuid
        REFERENCES public.material_request_lines(id) ON DELETE RESTRICT;

CREATE INDEX inventory_movements_material_request_id_idx
    ON public.inventory_movements (material_request_id);
CREATE INDEX inventory_movements_material_request_line_id_idx
    ON public.inventory_movements (material_request_line_id);

CREATE OR REPLACE FUNCTION public.enforce_inventory_movement_request_refs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    v_line_request_id uuid;
BEGIN
    IF NEW.material_request_line_id IS NULL THEN
        IF NEW.material_request_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'MATERIAL_REQUEST_LINE_REQUIRED';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.material_request_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'MATERIAL_REQUEST_REQUIRED';
    END IF;

    SELECT line.request_id
    INTO v_line_request_id
    FROM public.material_request_lines AS line
    WHERE line.id = NEW.material_request_line_id;

    IF NOT FOUND OR v_line_request_id IS DISTINCT FROM NEW.material_request_id THEN
        RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'MATERIAL_REQUEST_LINE_MISMATCH';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_movements_request_refs_check
BEFORE INSERT OR UPDATE ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.enforce_inventory_movement_request_refs();

-- Conserva por OID las implementaciones finales de 026 para no duplicar su
-- maquina de estados comercial. Los wrappers mantienen las firmas publicas y
-- solo enrutan los casos aditivos dispatch/dispatched al helper nuevo.
ALTER FUNCTION public.inventory_transition_serialized_item(uuid, text, uuid, uuid, uuid, text, uuid)
    RENAME TO inventory_transition_serialized_item_legacy_026;
ALTER FUNCTION public.inventory_record_quantity_movement(uuid, text, numeric, text, uuid, uuid, text, uuid)
    RENAME TO inventory_record_quantity_movement_legacy_026;

CREATE OR REPLACE FUNCTION public.inventory_dispatch_serialized_item(
    p_item_id uuid,
    p_movement_type text,
    p_client_id uuid DEFAULT NULL,
    p_plant_id uuid DEFAULT NULL,
    p_device_id uuid DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_created_by uuid DEFAULT NULL,
    p_material_request_id uuid DEFAULT NULL,
    p_material_request_line_id uuid DEFAULT NULL
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    v_item public.inventory_items%ROWTYPE;
    v_from_status text;
    v_next_status text;
    v_plant_id uuid;
    v_device_plant_id uuid;
BEGIN
    SELECT item.*
    INTO v_item
    FROM public.inventory_items AS item
    WHERE item.id = p_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ITEM_NOT_FOUND';
    END IF;

    v_from_status := v_item.status;
    v_plant_id := v_item.plant_id;

    IF v_item.status = 'available' AND p_movement_type = 'dispatch' THEN
        IF p_client_id IS NOT NULL OR p_device_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRANSITION';
        END IF;
        IF p_plant_id IS NOT NULL THEN
            PERFORM 1 FROM public.plants WHERE id = p_plant_id FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PLANT';
            END IF;
        END IF;
        v_next_status := 'dispatched';
        v_plant_id := p_plant_id;

        UPDATE public.inventory_items
        SET status = v_next_status,
            client_id = NULL,
            plant_id = v_plant_id,
            device_id = NULL,
            updated_at = pg_catalog.now()
        WHERE id = v_item.id
        RETURNING * INTO v_item;

    ELSIF v_item.status = 'dispatched' AND p_movement_type = 'install' THEN
        IF p_client_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRANSITION';
        END IF;
        v_plant_id := COALESCE(v_item.plant_id, p_plant_id);
        IF v_plant_id IS NULL
            OR (p_plant_id IS NOT NULL AND p_plant_id IS DISTINCT FROM v_plant_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PLANT';
        END IF;
        PERFORM 1 FROM public.plants WHERE id = v_plant_id FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PLANT';
        END IF;
        IF p_device_id IS NOT NULL THEN
            SELECT device.plant_id INTO v_device_plant_id
            FROM public.devices AS device
            WHERE device.id = p_device_id
            FOR KEY SHARE;
            IF NOT FOUND OR v_device_plant_id IS DISTINCT FROM v_plant_id THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DEVICE_PLANT_MISMATCH';
            END IF;
        END IF;
        v_next_status := 'installed';

        UPDATE public.inventory_items
        SET status = v_next_status,
            plant_id = v_plant_id,
            device_id = p_device_id,
            updated_at = pg_catalog.now()
        WHERE id = v_item.id
        RETURNING * INTO v_item;

    ELSIF v_item.status = 'dispatched' AND p_movement_type = 'sell' THEN
        IF p_client_id IS NOT NULL OR p_device_id IS NOT NULL
            OR (p_plant_id IS NOT NULL AND p_plant_id IS DISTINCT FROM v_item.plant_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRANSITION';
        END IF;
        v_next_status := 'sold';

        UPDATE public.inventory_items
        SET status = v_next_status,
            updated_at = pg_catalog.now()
        WHERE id = v_item.id
        RETURNING * INTO v_item;

    ELSIF v_item.status = 'dispatched' AND p_movement_type = 'return' THEN
        IF p_client_id IS NOT NULL OR p_plant_id IS NOT NULL OR p_device_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRANSITION';
        END IF;
        v_next_status := 'available';

        UPDATE public.inventory_items
        SET status = v_next_status,
            client_id = NULL,
            plant_id = NULL,
            device_id = NULL,
            updated_at = pg_catalog.now()
        WHERE id = v_item.id
        RETURNING * INTO v_item;
    ELSE
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRANSITION';
    END IF;

    INSERT INTO public.inventory_movements (
        product_id, item_id, movement_type, quantity, from_status, to_status,
        client_id, plant_id, device_id, notes, created_by,
        material_request_id, material_request_line_id
    ) VALUES (
        v_item.product_id, v_item.id, p_movement_type, 1, v_from_status, v_next_status,
        NULL, v_plant_id, p_device_id, p_notes, p_created_by,
        p_material_request_id, p_material_request_line_id
    );

    RETURN v_item;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_dispatch_quantity(
    p_product_id uuid,
    p_quantity numeric,
    p_plant_id uuid DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_created_by uuid DEFAULT NULL,
    p_material_request_id uuid DEFAULT NULL,
    p_material_request_line_id uuid DEFAULT NULL
)
RETURNS public.inventory_movements
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    v_tracking_mode text;
    v_available numeric;
    v_dispatched numeric;
    v_assigned numeric;
    v_installed numeric;
    v_physical_stock numeric;
    v_movement public.inventory_movements%ROWTYPE;
BEGIN
    -- The product row is the deterministic mutex for every quantity mutation.
    SELECT product.tracking_mode
    INTO v_tracking_mode
    FROM public.inventory_products AS product
    WHERE product.id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRODUCT_NOT_FOUND';
    END IF;
    IF v_tracking_mode <> 'quantity' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRACKING_MODE';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0
        OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_QUANTITY';
    END IF;
    IF p_plant_id IS NOT NULL THEN
        PERFORM 1 FROM public.plants WHERE id = p_plant_id FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PLANT';
        END IF;
    END IF;

    SELECT
        COALESCE(SUM(CASE WHEN movement.to_status = 'available' THEN movement.quantity ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN movement.from_status = 'available' THEN movement.quantity ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN movement.to_status = 'dispatched' THEN movement.quantity ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN movement.from_status = 'dispatched' THEN movement.quantity ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN movement.to_status = 'assigned' THEN movement.quantity ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN movement.from_status = 'assigned' THEN movement.quantity ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN movement.to_status = 'installed' THEN movement.quantity ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN movement.from_status = 'installed' THEN movement.quantity ELSE 0 END), 0)
    INTO v_available, v_dispatched, v_assigned, v_installed
    FROM public.inventory_movements AS movement
    WHERE movement.product_id = p_product_id;

    v_physical_stock := v_available + v_dispatched + v_assigned + v_installed;
    IF v_available < p_quantity OR v_dispatched < 0 OR v_assigned < 0
        OR v_installed < 0 OR v_physical_stock < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_STOCK';
    END IF;

    INSERT INTO public.inventory_movements (
        product_id, item_id, movement_type, quantity, from_status, to_status,
        client_id, plant_id, device_id, notes, created_by,
        material_request_id, material_request_line_id
    ) VALUES (
        p_product_id, NULL, 'dispatch', p_quantity, 'available', 'dispatched',
        NULL, p_plant_id, NULL, p_notes, p_created_by,
        p_material_request_id, p_material_request_line_id
    )
    RETURNING * INTO v_movement;

    RETURN v_movement;
END;
$$;

-- Firmas publicas originales: dispatch nuevo; el resto conserva exactamente 026.
CREATE OR REPLACE FUNCTION public.inventory_transition_serialized_item(
    p_item_id uuid,
    p_movement_type text,
    p_client_id uuid DEFAULT NULL,
    p_plant_id uuid DEFAULT NULL,
    p_device_id uuid DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_created_by uuid DEFAULT NULL
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT item.status INTO v_status
    FROM public.inventory_items AS item
    WHERE item.id = p_item_id;

    IF p_movement_type = 'dispatch' OR v_status = 'dispatched' THEN
        RETURN public.inventory_dispatch_serialized_item(
            p_item_id, p_movement_type, p_client_id, p_plant_id, p_device_id,
            p_notes, p_created_by, NULL, NULL
        );
    END IF;

    RETURN public.inventory_transition_serialized_item_legacy_026(
        p_item_id, p_movement_type, p_client_id, p_plant_id, p_device_id,
        p_notes, p_created_by
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_record_quantity_movement(
    p_product_id uuid,
    p_movement_type text,
    p_quantity numeric,
    p_source_status text DEFAULT NULL,
    p_client_id uuid DEFAULT NULL,
    p_plant_id uuid DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_created_by uuid DEFAULT NULL
)
RETURNS public.inventory_movements
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_movement_type = 'dispatch' THEN
        IF p_source_status IS NOT NULL OR p_client_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRANSITION';
        END IF;
        RETURN public.inventory_dispatch_quantity(
            p_product_id, p_quantity, p_plant_id, p_notes, p_created_by, NULL, NULL
        );
    END IF;

    RETURN public.inventory_record_quantity_movement_legacy_026(
        p_product_id, p_movement_type, p_quantity, p_source_status,
        p_client_id, p_plant_id, p_notes, p_created_by
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_create(
    p_actor_id uuid,
    p_reason text,
    p_lines jsonb,
    p_priority text DEFAULT 'normal',
    p_plant_id uuid DEFAULT NULL,
    p_maintenance_visit_id uuid DEFAULT NULL,
    p_destination text DEFAULT NULL,
    p_required_at timestamptz DEFAULT NULL,
    p_observations text DEFAULT NULL
)
RETURNS public.material_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_request public.material_requests%ROWTYPE;
    v_line jsonb;
    v_product_id uuid;
    v_requested_quantity numeric;
BEGIN
    PERFORM 1
    FROM public.user_profiles AS profile
    WHERE profile.id = p_actor_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTOR_NOT_FOUND';
    END IF;

    IF p_lines IS NULL
        OR pg_catalog.jsonb_typeof(p_lines) <> 'array'
        OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_REQUEST_LINES';
    END IF;

    BEGIN
        IF EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements(p_lines) AS entry(value)
            GROUP BY (entry.value ->> 'product_id')::uuid
            HAVING count(*) > 1
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DUPLICATE_REQUEST_PRODUCT';
        END IF;
    EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_REQUEST_LINES';
    END;

    INSERT INTO public.material_requests (
        code, requested_by, plant_id, maintenance_visit_id, reason, priority,
        destination, required_at, observations
    ) VALUES (
        public.next_material_request_code(), p_actor_id, p_plant_id,
        p_maintenance_visit_id, p_reason, p_priority, p_destination,
        p_required_at, p_observations
    )
    RETURNING * INTO v_request;

    FOR v_line IN
        SELECT entry.value
        FROM pg_catalog.jsonb_array_elements(p_lines) AS entry(value)
    LOOP
        IF pg_catalog.jsonb_typeof(v_line) <> 'object' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_REQUEST_LINES';
        END IF;
        BEGIN
            v_product_id := (v_line ->> 'product_id')::uuid;
            v_requested_quantity := (v_line ->> 'requested_quantity')::numeric;
        EXCEPTION
            WHEN invalid_text_representation OR numeric_value_out_of_range THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_REQUEST_LINES';
        END;

        IF v_product_id IS NULL OR v_requested_quantity IS NULL
            OR v_requested_quantity <= 0
            OR v_requested_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_REQUEST_LINES';
        END IF;
        PERFORM 1
        FROM public.inventory_products AS product
        WHERE product.id = v_product_id
        FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRODUCT_NOT_FOUND';
        END IF;

        INSERT INTO public.material_request_lines (
            request_id, product_id, requested_quantity, observations
        ) VALUES (
            v_request.id, v_product_id, v_requested_quantity,
            v_line ->> 'observations'
        );
    END LOOP;

    INSERT INTO public.material_request_events (
        request_id, event_type, actor_id, metadata
    ) VALUES (
        v_request.id, 'requested', p_actor_id,
        pg_catalog.jsonb_build_object('line_count', pg_catalog.jsonb_array_length(p_lines))
    );
    RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_prepare_serialized_item(
    p_request_id uuid,
    p_request_line_id uuid,
    p_inventory_item_id uuid,
    p_actor_id uuid,
    p_observations text DEFAULT NULL
)
RETURNS public.material_request_lines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_request public.material_requests%ROWTYPE;
    v_line public.material_request_lines%ROWTYPE;
    v_tracking_mode text;
    v_item public.inventory_items%ROWTYPE;
    v_active_count numeric;
BEGIN
    SELECT request.* INTO v_request
    FROM public.material_requests AS request
    WHERE request.id = p_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REQUEST_NOT_FOUND';
    END IF;
    IF v_request.status <> 'preparing' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_REQUEST_TRANSITION';
    END IF;

    SELECT line.*
    INTO v_line
    FROM public.material_request_lines AS line
    WHERE line.id = p_request_line_id
      AND line.request_id = p_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REQUEST_LINE_NOT_FOUND';
    END IF;
    SELECT product.tracking_mode INTO v_tracking_mode
    FROM public.inventory_products AS product
    WHERE product.id = v_line.product_id;
    IF v_tracking_mode <> 'serialized' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRACKING_MODE';
    END IF;

    SELECT item.* INTO v_item
    FROM public.inventory_items AS item
    WHERE item.id = p_inventory_item_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ITEM_NOT_FOUND';
    END IF;
    IF v_item.product_id IS DISTINCT FROM v_line.product_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ITEM_PRODUCT_MISMATCH';
    END IF;
    IF v_item.status <> 'available' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ITEM_NOT_AVAILABLE';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.material_request_items AS request_item
        WHERE request_item.inventory_item_id = p_inventory_item_id
          AND request_item.delivered_at IS NULL
          AND request_item.released_at IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ITEM_ALREADY_RESERVED';
    END IF;

    INSERT INTO public.material_request_items (
        request_line_id, inventory_item_id, prepared_by
    ) VALUES (
        p_request_line_id, p_inventory_item_id, p_actor_id
    );

    SELECT count(*) INTO v_active_count
    FROM public.material_request_items AS request_item
    WHERE request_item.request_line_id = p_request_line_id
      AND request_item.delivered_at IS NULL
      AND request_item.released_at IS NULL;
    IF v_active_count > v_line.requested_quantity THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PREPARED_QUANTITY_EXCEEDS_REQUESTED';
    END IF;

    UPDATE public.material_request_lines
    SET prepared_quantity = v_active_count,
        updated_at = pg_catalog.now()
    WHERE id = p_request_line_id
    RETURNING * INTO v_line;

    INSERT INTO public.material_request_events (
        request_id, event_type, actor_id, metadata
    ) VALUES (
        p_request_id, 'item_prepared', p_actor_id,
        pg_catalog.jsonb_build_object(
            'request_line_id', p_request_line_id,
            'inventory_item_id', p_inventory_item_id,
            'prepared_quantity', v_active_count,
            'observations', p_observations
        )
    );
    RETURN v_line;
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_release_serialized_item(
    p_request_id uuid,
    p_request_line_id uuid,
    p_inventory_item_id uuid,
    p_actor_id uuid,
    p_observations text DEFAULT NULL
)
RETURNS public.material_request_lines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_request public.material_requests%ROWTYPE;
    v_line public.material_request_lines%ROWTYPE;
    v_tracking_mode text;
    v_request_item_id uuid;
    v_active_count numeric;
BEGIN
    SELECT request.* INTO v_request
    FROM public.material_requests AS request
    WHERE request.id = p_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REQUEST_NOT_FOUND';
    END IF;
    IF v_request.status <> 'preparing' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_REQUEST_TRANSITION';
    END IF;

    SELECT line.*
    INTO v_line
    FROM public.material_request_lines AS line
    WHERE line.id = p_request_line_id
      AND line.request_id = p_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REQUEST_LINE_NOT_FOUND';
    END IF;
    SELECT product.tracking_mode INTO v_tracking_mode
    FROM public.inventory_products AS product
    WHERE product.id = v_line.product_id;
    IF v_tracking_mode <> 'serialized' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRACKING_MODE';
    END IF;

    SELECT request_item.id INTO v_request_item_id
    FROM public.material_request_items AS request_item
    WHERE request_item.request_line_id = p_request_line_id
      AND request_item.inventory_item_id = p_inventory_item_id
      AND request_item.delivered_at IS NULL
      AND request_item.released_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTIVE_PREPARED_ITEM_NOT_FOUND';
    END IF;

    UPDATE public.material_request_items
    SET released_at = pg_catalog.now()
    WHERE id = v_request_item_id;

    SELECT count(*) INTO v_active_count
    FROM public.material_request_items AS request_item
    WHERE request_item.request_line_id = p_request_line_id
      AND request_item.delivered_at IS NULL
      AND request_item.released_at IS NULL;

    UPDATE public.material_request_lines
    SET prepared_quantity = v_active_count,
        updated_at = pg_catalog.now()
    WHERE id = p_request_line_id
    RETURNING * INTO v_line;

    INSERT INTO public.material_request_events (
        request_id, event_type, actor_id, metadata
    ) VALUES (
        p_request_id, 'preparation_updated', p_actor_id,
        pg_catalog.jsonb_build_object(
            'request_line_id', p_request_line_id,
            'released_inventory_item_id', p_inventory_item_id,
            'prepared_quantity', v_active_count,
            'observations', p_observations
        )
    );
    RETURN v_line;
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_set_prepared_quantity(
    p_request_id uuid,
    p_request_line_id uuid,
    p_prepared_quantity numeric,
    p_actor_id uuid,
    p_observations text DEFAULT NULL
)
RETURNS public.material_request_lines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_request public.material_requests%ROWTYPE;
    v_line public.material_request_lines%ROWTYPE;
    v_tracking_mode text;
BEGIN
    SELECT request.* INTO v_request
    FROM public.material_requests AS request
    WHERE request.id = p_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REQUEST_NOT_FOUND';
    END IF;
    IF v_request.status <> 'preparing' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_REQUEST_TRANSITION';
    END IF;

    SELECT line.*
    INTO v_line
    FROM public.material_request_lines AS line
    WHERE line.id = p_request_line_id
      AND line.request_id = p_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REQUEST_LINE_NOT_FOUND';
    END IF;
    SELECT product.tracking_mode INTO v_tracking_mode
    FROM public.inventory_products AS product
    WHERE product.id = v_line.product_id;
    IF v_tracking_mode <> 'quantity' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRACKING_MODE';
    END IF;
    IF p_prepared_quantity IS NULL OR p_prepared_quantity < 0
        OR p_prepared_quantity > v_line.requested_quantity
        OR p_prepared_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PREPARED_QUANTITY';
    END IF;

    UPDATE public.material_request_lines
    SET prepared_quantity = p_prepared_quantity,
        updated_at = pg_catalog.now()
    WHERE id = p_request_line_id
    RETURNING * INTO v_line;

    INSERT INTO public.material_request_events (
        request_id, event_type, actor_id, metadata
    ) VALUES (
        p_request_id, 'preparation_updated', p_actor_id,
        pg_catalog.jsonb_build_object(
            'request_line_id', p_request_line_id,
            'prepared_quantity', p_prepared_quantity,
            'observations', p_observations
        )
    );
    RETURN v_line;
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_transition(
    p_request_id uuid,
    p_target_status text,
    p_actor_id uuid,
    p_idempotency_key uuid DEFAULT NULL
)
RETURNS public.material_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_request public.material_requests%ROWTYPE;
    v_event_type text;
    v_previous_status text;
BEGIN
    SELECT request.* INTO v_request
    FROM public.material_requests AS request
    WHERE request.id = p_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REQUEST_NOT_FOUND';
    END IF;

    v_event_type := CASE p_target_status
        WHEN 'received' THEN 'received'
        WHEN 'preparing' THEN 'preparing_started'
        WHEN 'ready' THEN 'ready'
        WHEN 'rejected' THEN 'rejected'
        ELSE NULL
    END;
    IF v_event_type IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_REQUEST_TRANSITION';
    END IF;

    IF p_idempotency_key IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.material_request_events AS event
        WHERE event.request_id = p_request_id
          AND event.event_type = v_event_type
          AND event.idempotency_key = p_idempotency_key
    ) THEN
        RETURN v_request;
    END IF;

    IF NOT (
        (v_request.status = 'requested' AND p_target_status IN ('received', 'rejected'))
        OR (v_request.status = 'received' AND p_target_status = 'preparing')
        OR (v_request.status = 'preparing' AND p_target_status = 'ready')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_REQUEST_TRANSITION';
    END IF;

    IF p_target_status = 'ready' AND EXISTS (
        SELECT 1
        FROM public.material_request_lines AS line
        JOIN public.inventory_products AS product ON product.id = line.product_id
        WHERE line.request_id = p_request_id
          AND (
              line.prepared_quantity > line.requested_quantity
              OR (
                  product.tracking_mode = 'serialized'
                  AND line.prepared_quantity <> (
                      SELECT count(*)
                      FROM public.material_request_items AS request_item
                      WHERE request_item.request_line_id = line.id
                        AND request_item.delivered_at IS NULL
                        AND request_item.released_at IS NULL
                  )
              )
              OR (
                  product.tracking_mode = 'serialized'
                  AND EXISTS (
                      SELECT 1
                      FROM public.material_request_items AS request_item
                      JOIN public.inventory_items AS item
                        ON item.id = request_item.inventory_item_id
                      WHERE request_item.request_line_id = line.id
                        AND request_item.delivered_at IS NULL
                        AND request_item.released_at IS NULL
                        AND (
                            item.product_id IS DISTINCT FROM line.product_id
                            OR item.status <> 'available'
                        )
                  )
              )
          )
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PREPARATION_INCONSISTENT';
    END IF;

    v_previous_status := v_request.status;
    PERFORM pg_catalog.set_config('app.material_request_status_rpc', 'authorized', true);
    UPDATE public.material_requests
    SET status = p_target_status, updated_at = pg_catalog.now()
    WHERE id = p_request_id
    RETURNING * INTO v_request;

    INSERT INTO public.material_request_events (
        request_id, event_type, actor_id, metadata, idempotency_key
    ) VALUES (
        p_request_id, v_event_type, p_actor_id,
        pg_catalog.jsonb_build_object('from_status', v_previous_status, 'to_status', p_target_status),
        p_idempotency_key
    );
    RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_cancel(
    p_request_id uuid,
    p_actor_id uuid,
    p_idempotency_key uuid DEFAULT NULL
)
RETURNS public.material_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_request public.material_requests%ROWTYPE;
    v_previous_status text;
    v_released_count bigint;
BEGIN
    SELECT request.* INTO v_request
    FROM public.material_requests AS request
    WHERE request.id = p_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REQUEST_NOT_FOUND';
    END IF;

    IF p_idempotency_key IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.material_request_events AS event
        WHERE event.request_id = p_request_id
          AND event.event_type = 'cancelled'
          AND event.idempotency_key = p_idempotency_key
    ) THEN
        RETURN v_request;
    END IF;
    IF v_request.status NOT IN ('requested', 'received', 'preparing', 'ready') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_REQUEST_TRANSITION';
    END IF;

    v_previous_status := v_request.status;
    UPDATE public.material_request_items AS request_item
    SET released_at = pg_catalog.now()
    FROM public.material_request_lines AS line
    WHERE request_item.request_line_id = line.id
      AND line.request_id = p_request_id
      AND request_item.delivered_at IS NULL
      AND request_item.released_at IS NULL;
    GET DIAGNOSTICS v_released_count = ROW_COUNT;

    PERFORM pg_catalog.set_config('app.material_request_status_rpc', 'authorized', true);
    UPDATE public.material_requests
    SET status = 'cancelled', updated_at = pg_catalog.now()
    WHERE id = p_request_id
    RETURNING * INTO v_request;

    INSERT INTO public.material_request_events (
        request_id, event_type, actor_id, metadata, idempotency_key
    ) VALUES (
        p_request_id, 'cancelled', p_actor_id,
        pg_catalog.jsonb_build_object(
            'from_status', v_previous_status,
            'released_items', v_released_count
        ),
        p_idempotency_key
    );
    RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.material_request_deliver(
    p_request_id uuid,
    p_actor_id uuid,
    p_deliveries jsonb,
    p_idempotency_key uuid DEFAULT NULL
)
RETURNS public.material_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_request public.material_requests%ROWTYPE;
    v_line record;
    v_request_item record;
    v_delivery_quantity numeric;
    v_active_items numeric;
    v_delivered_items bigint := 0;
    v_released_items bigint := 0;
    v_line_released_items bigint;
    v_canonical_deliveries jsonb;
    v_previous_deliveries jsonb;
BEGIN
    SELECT request.* INTO v_request
    FROM public.material_requests AS request
    WHERE request.id = p_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REQUEST_NOT_FOUND';
    END IF;

    IF p_deliveries IS NULL OR pg_catalog.jsonb_typeof(p_deliveries) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DELIVERIES';
    END IF;
    IF (
            SELECT count(*)
            FROM pg_catalog.jsonb_object_keys(p_deliveries) AS delivery(line_id)
        ) <> (
            SELECT count(*) FROM public.material_request_lines AS line
            WHERE line.request_id = p_request_id
        )
        OR EXISTS (
            SELECT 1
            FROM public.material_request_lines AS line
            WHERE line.request_id = p_request_id
              AND NOT (p_deliveries ? line.id::text)
        )
        OR EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_object_keys(p_deliveries) AS delivery(line_id)
            WHERE NOT EXISTS (
                SELECT 1 FROM public.material_request_lines AS line
                WHERE line.request_id = p_request_id
                  AND line.id::text = delivery.line_id
            )
        ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DELIVERY_LINES_MISMATCH';
    END IF;

    BEGIN
        SELECT pg_catalog.jsonb_object_agg(
            line.id::text,
            pg_catalog.to_jsonb((p_deliveries ->> line.id::text)::numeric)
        )
        INTO v_canonical_deliveries
        FROM public.material_request_lines AS line
        WHERE line.request_id = p_request_id;
    EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DELIVERIES';
    END;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT event.metadata -> 'deliveries'
        INTO v_previous_deliveries
        FROM public.material_request_events AS event
        WHERE event.request_id = p_request_id
          AND event.event_type = 'delivered'
          AND event.idempotency_key = p_idempotency_key;
        IF FOUND THEN
            IF v_previous_deliveries IS DISTINCT FROM v_canonical_deliveries THEN
                RAISE EXCEPTION USING
                    ERRCODE = 'P0001',
                    MESSAGE = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
            END IF;
            RETURN v_request;
        END IF;
    END IF;
    IF v_request.status <> 'ready' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_REQUEST_TRANSITION';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.material_request_lines AS line
        JOIN public.inventory_products AS product ON product.id = line.product_id
        WHERE line.request_id = p_request_id
          AND product.tracking_mode = 'serialized'
          AND line.prepared_quantity <> (
              SELECT count(*)
              FROM public.material_request_items AS request_item
              WHERE request_item.request_line_id = line.id
                AND request_item.delivered_at IS NULL
                AND request_item.released_at IS NULL
          )
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PREPARATION_INCONSISTENT';
    END IF;

    -- Product-first ordering matches the quantity product-row mutex order.
    FOR v_line IN
        SELECT line.*, product.tracking_mode
        FROM public.material_request_lines AS line
        JOIN public.inventory_products AS product ON product.id = line.product_id
        WHERE line.request_id = p_request_id
        ORDER BY line.product_id, line.id
        FOR UPDATE OF line
    LOOP
        BEGIN
            v_delivery_quantity := (v_canonical_deliveries ->> v_line.id::text)::numeric;
        EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DELIVERIES';
        END;

        IF v_delivery_quantity IS NULL
            OR v_delivery_quantity < 0
            OR v_delivery_quantity > v_line.prepared_quantity
            OR v_line.prepared_quantity > v_line.requested_quantity
            OR v_delivery_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DELIVERY_QUANTITY';
        END IF;

        IF v_line.tracking_mode = 'serialized' THEN
            IF v_delivery_quantity <> pg_catalog.trunc(v_delivery_quantity) THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DELIVERY_QUANTITY';
            END IF;

            SELECT count(*) INTO v_active_items
            FROM public.material_request_items AS request_item
            WHERE request_item.request_line_id = v_line.id
              AND request_item.delivered_at IS NULL
              AND request_item.released_at IS NULL;
            IF v_active_items <> v_line.prepared_quantity THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PREPARED_ITEMS_MISMATCH';
            END IF;

            FOR v_request_item IN
                SELECT request_item.id, request_item.inventory_item_id, item.product_id
                FROM public.material_request_items AS request_item
                JOIN public.inventory_items AS item
                  ON item.id = request_item.inventory_item_id
                WHERE request_item.request_line_id = v_line.id
                  AND request_item.delivered_at IS NULL
                  AND request_item.released_at IS NULL
                ORDER BY request_item.inventory_item_id
                LIMIT v_delivery_quantity::bigint
                FOR UPDATE OF request_item, item
            LOOP
                IF v_request_item.product_id IS DISTINCT FROM v_line.product_id THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ITEM_PRODUCT_MISMATCH';
                END IF;
                PERFORM public.inventory_dispatch_serialized_item(
                    v_request_item.inventory_item_id, 'dispatch', NULL, v_request.plant_id,
                    NULL, 'Material request ' || v_request.code, p_actor_id,
                    p_request_id, v_line.id
                );
                UPDATE public.material_request_items
                SET delivered_at = pg_catalog.now()
                WHERE id = v_request_item.id;
                v_delivered_items := v_delivered_items + 1;
            END LOOP;

            UPDATE public.material_request_items
            SET released_at = pg_catalog.now()
            WHERE request_line_id = v_line.id
              AND delivered_at IS NULL
              AND released_at IS NULL;
            GET DIAGNOSTICS v_line_released_items = ROW_COUNT;
            v_released_items := v_released_items + v_line_released_items;

        ELSIF v_line.tracking_mode = 'quantity' THEN
            IF v_delivery_quantity > 0 THEN
                PERFORM public.inventory_dispatch_quantity(
                    v_line.product_id, v_delivery_quantity, v_request.plant_id,
                    'Material request ' || v_request.code, p_actor_id,
                    p_request_id, v_line.id
                );
            END IF;
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRACKING_MODE';
        END IF;

        UPDATE public.material_request_lines
        SET delivered_quantity = v_delivery_quantity,
            updated_at = pg_catalog.now()
        WHERE id = v_line.id;
    END LOOP;

    PERFORM pg_catalog.set_config('app.material_request_status_rpc', 'authorized', true);
    UPDATE public.material_requests
    SET status = 'delivered', updated_at = pg_catalog.now()
    WHERE id = p_request_id
    RETURNING * INTO v_request;

    INSERT INTO public.material_request_events (
        request_id, event_type, actor_id, metadata, idempotency_key
    ) VALUES (
        p_request_id, 'delivered', p_actor_id,
        pg_catalog.jsonb_build_object(
            'delivered_serial_items', v_delivered_items,
            'released_serial_items', v_released_items,
            'deliveries', v_canonical_deliveries
        ),
        p_idempotency_key
    );
    RETURN v_request;
END;
$$;

ALTER TABLE public.material_request_code_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_request_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
    public.material_request_code_counters,
    public.material_requests,
    public.material_request_lines,
    public.material_request_items,
    public.material_request_events
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
    public.material_requests,
    public.material_request_lines,
    public.material_request_items,
    public.material_request_events
TO service_role;

REVOKE EXECUTE ON FUNCTION public.next_material_request_code()
FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.protect_material_request_status()
FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.inventory_dispatch_serialized_item(uuid, text, uuid, uuid, uuid, text, uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inventory_dispatch_quantity(uuid, numeric, uuid, text, uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inventory_transition_serialized_item_legacy_026(uuid, text, uuid, uuid, uuid, text, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inventory_record_quantity_movement_legacy_026(uuid, text, numeric, text, uuid, uuid, text, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inventory_transition_serialized_item(uuid, text, uuid, uuid, uuid, text, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inventory_record_quantity_movement(uuid, text, numeric, text, uuid, uuid, text, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.material_request_create(uuid, text, jsonb, text, uuid, uuid, text, timestamptz, text)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.material_request_prepare_serialized_item(uuid, uuid, uuid, uuid, text)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.material_request_release_serialized_item(uuid, uuid, uuid, uuid, text)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.material_request_set_prepared_quantity(uuid, uuid, numeric, uuid, text)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.material_request_transition(uuid, text, uuid, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.material_request_cancel(uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.material_request_deliver(uuid, uuid, jsonb, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.inventory_transition_serialized_item(uuid, text, uuid, uuid, uuid, text, uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_record_quantity_movement(uuid, text, numeric, text, uuid, uuid, text, uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_dispatch_serialized_item(uuid, text, uuid, uuid, uuid, text, uuid, uuid, uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_dispatch_quantity(uuid, numeric, uuid, text, uuid, uuid, uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION public.material_request_create(uuid, text, jsonb, text, uuid, uuid, text, timestamptz, text)
TO service_role;
GRANT EXECUTE ON FUNCTION public.material_request_prepare_serialized_item(uuid, uuid, uuid, uuid, text)
TO service_role;
GRANT EXECUTE ON FUNCTION public.material_request_release_serialized_item(uuid, uuid, uuid, uuid, text)
TO service_role;
GRANT EXECUTE ON FUNCTION public.material_request_set_prepared_quantity(uuid, uuid, numeric, uuid, text)
TO service_role;
GRANT EXECUTE ON FUNCTION public.material_request_transition(uuid, text, uuid, uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION public.material_request_cancel(uuid, uuid, uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION public.material_request_deliver(uuid, uuid, jsonb, uuid)
TO service_role;

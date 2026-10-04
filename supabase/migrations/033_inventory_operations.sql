-- Inventario V1: operaciones multi-item de almacén (modelo + RPC).
--
-- 031 y 032 congeladas: no se editan. Esta migración crea el modelo
-- documental de operaciones físicas de almacén (cabecera + líneas),
-- agrega trazabilidad en inventory_movements, protecciones de
-- inmutabilidad/idempotencia, extiende de forma backward-compatible las
-- RPC de Inventory existentes y agrega inventory_operation_create,
-- inventory_operation_confirm e inventory_operation_cancel.
-- Tipos V1: IN, ADJUST_IN, ADJUST_OUT. RETURN queda FUERA de V1.
-- Para serialized, V1 únicamente permite IN.
-- inventory_items sigue siendo la fuente autoritativa del activo;
-- inventory_operation_lines.serial_numbers es solo snapshot del documento.

CREATE TABLE public.inventory_operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_type text NOT NULL
        CHECK (operation_type IN ('IN', 'ADJUST_IN', 'ADJUST_OUT')),
    operation_date date NOT NULL DEFAULT CURRENT_DATE,
    reference text,
    notes text,
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'confirmed', 'cancelled')),
    created_by uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    confirmed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    confirmed_at timestamptz,
    cancelled_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    cancelled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_operation_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id uuid NOT NULL REFERENCES public.inventory_operations(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE RESTRICT,
    quantity numeric NOT NULL CHECK (quantity > 0),
    serial_numbers jsonb
        CHECK (serial_numbers IS NULL OR pg_catalog.jsonb_typeof(serial_numbers) = 'array'),
    notes text,
    line_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT inventory_operation_lines_unique_product
        UNIQUE (operation_id, product_id)
);

CREATE INDEX inventory_operations_status_idx
    ON public.inventory_operations (status);
CREATE INDEX inventory_operations_type_idx
    ON public.inventory_operations (operation_type);
CREATE INDEX inventory_operations_date_idx
    ON public.inventory_operations (operation_date);
CREATE INDEX inventory_operations_created_idx
    ON public.inventory_operations (created_at DESC);
CREATE INDEX inventory_operation_lines_operation_idx
    ON public.inventory_operation_lines (operation_id);
CREATE INDEX inventory_operation_lines_product_idx
    ON public.inventory_operation_lines (product_id);

-- Trazabilidad del ledger: cada movimiento puede originarse en una
-- operación de inventario (o en una solicitud MAT, o en ninguna, como el
-- historial existente). Ambos orígenes nunca coexisten en un movimiento.
ALTER TABLE public.inventory_movements
    ADD COLUMN inventory_operation_id uuid
        REFERENCES public.inventory_operations(id) ON DELETE RESTRICT,
    ADD COLUMN inventory_operation_line_id uuid
        REFERENCES public.inventory_operation_lines(id) ON DELETE RESTRICT;

CREATE INDEX inventory_movements_operation_id_idx
    ON public.inventory_movements (inventory_operation_id);
CREATE INDEX inventory_movements_operation_line_id_idx
    ON public.inventory_movements (inventory_operation_line_id);

-- Extensión mínima del validador existente de 031: mantiene intactas las
-- reglas MAT y agrega las reglas de operaciones de inventario.
CREATE OR REPLACE FUNCTION public.enforce_inventory_movement_request_refs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    v_line_request_id uuid;
    v_line_operation_id uuid;
BEGIN
    IF NEW.material_request_line_id IS NULL THEN
        IF NEW.material_request_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'MATERIAL_REQUEST_LINE_REQUIRED';
        END IF;
    ELSE
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
    END IF;

    IF NEW.inventory_operation_line_id IS NULL THEN
        IF NEW.inventory_operation_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVENTORY_OPERATION_LINE_REQUIRED';
        END IF;
    ELSE
        IF NEW.inventory_operation_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVENTORY_OPERATION_REQUIRED';
        END IF;

        SELECT line.operation_id
        INTO v_line_operation_id
        FROM public.inventory_operation_lines AS line
        WHERE line.id = NEW.inventory_operation_line_id;

        IF NOT FOUND OR v_line_operation_id IS DISTINCT FROM NEW.inventory_operation_id THEN
            RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'INVENTORY_OPERATION_LINE_MISMATCH';
        END IF;
    END IF;

    IF NEW.material_request_id IS NOT NULL AND NEW.inventory_operation_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'MIXED_MOVEMENT_ORIGIN';
    END IF;

    RETURN NEW;
END;
$$;

-- Inmutabilidad documental: confirmed/cancelled no se modifican ni
-- eliminan. Las transiciones draft → confirmed y draft → cancelled tienen
-- OLD.status = 'draft', por lo que las futuras RPC pueden realizarlas sin
-- bypass adicional. El draft sigue editable para fases posteriores.
CREATE OR REPLACE FUNCTION public.protect_inventory_operation_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'IMMUTABLE_OPERATION';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_operations_immutable_guard
BEFORE UPDATE OR DELETE ON public.inventory_operations
FOR EACH ROW EXECUTE FUNCTION public.protect_inventory_operation_immutable();

CREATE OR REPLACE FUNCTION public.protect_inventory_operation_line_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    v_old_status text;
    v_new_status text;
BEGIN
    SELECT operation.status INTO v_old_status
    FROM public.inventory_operations AS operation
    WHERE operation.id = OLD.operation_id;

    IF v_old_status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'IMMUTABLE_OPERATION';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
        SELECT operation.status INTO v_new_status
        FROM public.inventory_operations AS operation
        WHERE operation.id = NEW.operation_id;

        IF v_new_status IS DISTINCT FROM 'draft' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = 'IMMUTABLE_OPERATION';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_operation_lines_immutable_guard
BEFORE UPDATE OR DELETE ON public.inventory_operation_lines
FOR EACH ROW EXECUTE FUNCTION public.protect_inventory_operation_line_immutable();

-- Seguridad: mismo patrón que Inventory en 024 (tablas solo vía
-- service_role/RPC SECURITY DEFINER; sin políticas nuevas).
ALTER TABLE public.inventory_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_operation_lines ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
    public.inventory_operations,
    public.inventory_operation_lines
FROM PUBLIC, anon, authenticated;

-- Fase 2: extensión backward-compatible de RPCs + inventory_operation_create.
--
-- Estrategia de firma (patrón 032): DROP FUNCTION con la firma EXACTA
-- anterior + CREATE con parámetros opcionales nuevos al final
-- (DEFAULT NULL). Las llamadas existentes usan parámetros nombrados
-- (PostgREST) o los 7 posicionales internos de material_request_deliver,
-- por lo que siguen funcionando sin cambios. Sin CASCADE ni overloads
-- ambiguos: cada nombre conserva una única firma pública.
-- Las RPC internas (_legacy_026, dispatch_quantity) se extienden solo para
-- propagar las referencias de operación; MAT las invoca sin esos
-- parámetros y su comportamiento es idéntico.

ALTER TABLE public.inventory_operations
    ADD COLUMN create_idempotency_key uuid UNIQUE;

-- Idempotencia de CREATE independiente de las futuras claves de
-- CONFIRM/CANCEL (fase 3): mismo p_idempotency_key + retry del mismo
-- create devuelve la operación existente sin duplicar cabecera/líneas.

DROP FUNCTION public.inventory_create_serialized_item(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.inventory_create_serialized_item(
    p_product_id uuid,
    p_serial_number text,
    p_notes text DEFAULT NULL,
    p_created_by uuid DEFAULT NULL,
    p_inventory_operation_id uuid DEFAULT NULL,
    p_inventory_operation_line_id uuid DEFAULT NULL
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    v_tracking_mode text;
    v_serial_number text;
    v_item public.inventory_items%ROWTYPE;
BEGIN
    SELECT product.tracking_mode
    INTO v_tracking_mode
    FROM public.inventory_products AS product
    WHERE product.id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRODUCT_NOT_FOUND';
    END IF;
    IF v_tracking_mode <> 'serialized' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRACKING_MODE';
    END IF;

    v_serial_number := pg_catalog.upper(pg_catalog.btrim(p_serial_number));
    IF v_serial_number IS NULL OR v_serial_number = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SERIAL';
    END IF;

    INSERT INTO public.inventory_items (
        product_id, serial_number, status, client_id, plant_id, device_id
    ) VALUES (
        p_product_id, v_serial_number, 'available', NULL, NULL, NULL
    )
    RETURNING * INTO v_item;

    INSERT INTO public.inventory_movements (
        product_id, item_id, movement_type, quantity, from_status, to_status,
        client_id, plant_id, device_id, notes, created_by,
        inventory_operation_id, inventory_operation_line_id
    ) VALUES (
        p_product_id, v_item.id, 'in', 1, NULL, 'available',
        NULL, NULL, NULL, p_notes, p_created_by,
        p_inventory_operation_id, p_inventory_operation_line_id
    );

    RETURN v_item;
END;
$$;

DROP FUNCTION public.inventory_record_quantity_movement_legacy_026(uuid, text, numeric, text, uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.inventory_record_quantity_movement_legacy_026(
    p_product_id uuid,
    p_movement_type text,
    p_quantity numeric,
    p_source_status text DEFAULT NULL,
    p_client_id uuid DEFAULT NULL,
    p_plant_id uuid DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_created_by uuid DEFAULT NULL,
    p_inventory_operation_id uuid DEFAULT NULL,
    p_inventory_operation_line_id uuid DEFAULT NULL
)
RETURNS public.inventory_movements
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    v_tracking_mode text;
    v_available numeric := 0;
    v_assigned numeric := 0;
    v_installed numeric := 0;
    v_sold numeric := 0;
    v_written_off numeric := 0;
    v_scoped_balance numeric := 0;
    v_from_status text;
    v_to_status text;
    v_movement public.inventory_movements%ROWTYPE;
    v_client_active boolean;
BEGIN
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

    SELECT
        COALESCE(SUM(CASE WHEN movement.to_status = 'available' THEN movement.quantity ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN movement.from_status = 'available' THEN movement.quantity ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN movement.to_status = 'assigned' THEN movement.quantity ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN movement.from_status = 'assigned' THEN movement.quantity ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN movement.to_status = 'installed' THEN movement.quantity ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN movement.from_status = 'installed' THEN movement.quantity ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN movement.to_status = 'sold' THEN movement.quantity ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN movement.from_status = 'sold' THEN movement.quantity ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN movement.to_status = 'written_off' THEN movement.quantity ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN movement.from_status = 'written_off' THEN movement.quantity ELSE 0 END), 0)
    INTO v_available, v_assigned, v_installed, v_sold, v_written_off
    FROM public.inventory_movements AS movement
    WHERE movement.product_id = p_product_id;

    IF v_available < 0 OR v_assigned < 0 OR v_installed < 0
        OR v_sold < 0 OR v_written_off < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_STOCK';
    END IF;
    IF v_available::text IN ('NaN', 'Infinity', '-Infinity')
        OR v_assigned::text IN ('NaN', 'Infinity', '-Infinity')
        OR v_installed::text IN ('NaN', 'Infinity', '-Infinity')
        OR v_sold::text IN ('NaN', 'Infinity', '-Infinity')
        OR v_written_off::text IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_QUANTITY';
    END IF;

    IF p_movement_type IN ('in', 'adjust_in') THEN
        IF p_source_status IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SOURCE_STATUS';
        END IF;
        IF p_client_id IS NOT NULL OR p_plant_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        v_from_status := NULL;
        v_to_status := 'available';

    ELSIF p_movement_type = 'adjust_out' THEN
        IF p_source_status IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SOURCE_STATUS';
        END IF;
        IF p_client_id IS NOT NULL OR p_plant_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        IF v_available < p_quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_STOCK';
        END IF;
        v_from_status := 'available';
        v_to_status := NULL;

    ELSIF p_movement_type = 'assign' THEN
        IF p_source_status IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SOURCE_STATUS';
        END IF;
        -- Assign admite cliente solo, planta solo o ambos (al menos uno).
        -- Un cliente NUEVO debe existir y estar activo.
        IF p_client_id IS NULL AND p_plant_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        IF p_client_id IS NOT NULL THEN
            SELECT c.active INTO v_client_active
            FROM public.clients AS c
            WHERE c.id = p_client_id
            FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
            IF NOT v_client_active THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INACTIVE_CLIENT';
            END IF;
        END IF;
        IF p_plant_id IS NOT NULL THEN
            PERFORM 1 FROM public.plants WHERE id = p_plant_id FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
        END IF;
        IF v_available < p_quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_STOCK';
        END IF;
        v_from_status := 'available';
        v_to_status := 'assigned';

    ELSIF p_movement_type IN ('install', 'return') THEN
        IF p_source_status IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SOURCE_STATUS';
        END IF;
        -- Install exige planta destino (installed nunca queda sin planta).
        IF p_movement_type = 'install' AND p_plant_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        -- Contexto independiente: cada ID se valida por separado (existencia;
        -- sin active: el alcance referencia asociaciones ya registradas).
        -- El saldo se consume del alcance destino exacto. Stock assigned sin
        -- planta (client_id, NULL) no es instalable en un paso: vía segura
        -- return(client, NULL) + assign(client, planta) con trazabilidad.
        IF p_client_id IS NOT NULL THEN
            PERFORM 1 FROM public.clients WHERE id = p_client_id FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
        END IF;
        IF p_plant_id IS NOT NULL THEN
            PERFORM 1 FROM public.plants WHERE id = p_plant_id FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
        END IF;

        SELECT COALESCE(
            SUM(CASE WHEN movement.to_status = 'assigned' THEN movement.quantity ELSE 0 END)
            - SUM(CASE WHEN movement.from_status = 'assigned' THEN movement.quantity ELSE 0 END),
            0
        )
        INTO v_scoped_balance
        FROM public.inventory_movements AS movement
        WHERE movement.product_id = p_product_id
          AND movement.client_id IS NOT DISTINCT FROM p_client_id
          AND movement.plant_id IS NOT DISTINCT FROM p_plant_id;

        IF v_scoped_balance < p_quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_STOCK';
        END IF;
        v_from_status := 'assigned';
        v_to_status := CASE p_movement_type
            WHEN 'install' THEN 'installed'
            ELSE 'available'
        END;

    ELSIF p_movement_type = 'sell' THEN
        IF p_source_status NOT IN ('available', 'assigned') OR p_source_status IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SOURCE_STATUS';
        END IF;
        -- Contexto opcional e independiente: cada ID se valida por separado.
        -- Un cliente NUEVO (venta desde disponible) debe estar activo.
        IF p_client_id IS NOT NULL THEN
            SELECT c.active INTO v_client_active
            FROM public.clients AS c
            WHERE c.id = p_client_id
            FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
            IF p_source_status = 'available' AND NOT v_client_active THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INACTIVE_CLIENT';
            END IF;
        END IF;
        IF p_plant_id IS NOT NULL THEN
            PERFORM 1 FROM public.plants WHERE id = p_plant_id FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
        END IF;

        IF p_source_status = 'available' THEN
            IF v_available < p_quantity THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_STOCK';
            END IF;
        ELSE
            -- Venta desde asignado: el contexto delimita el saldo.
            IF p_client_id IS NULL AND p_plant_id IS NULL THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
            SELECT COALESCE(
                SUM(CASE WHEN movement.to_status = 'assigned' THEN movement.quantity ELSE 0 END)
                - SUM(CASE WHEN movement.from_status = 'assigned' THEN movement.quantity ELSE 0 END),
                0
            )
            INTO v_scoped_balance
            FROM public.inventory_movements AS movement
            WHERE movement.product_id = p_product_id
              AND movement.client_id IS NOT DISTINCT FROM p_client_id
              AND movement.plant_id IS NOT DISTINCT FROM p_plant_id;
            IF v_scoped_balance < p_quantity THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_STOCK';
            END IF;
        END IF;
        v_from_status := p_source_status;
        v_to_status := 'sold';

    ELSIF p_movement_type = 'write_off' THEN
        IF p_source_status NOT IN ('available', 'assigned', 'installed')
            OR p_source_status IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SOURCE_STATUS';
        END IF;
        IF p_source_status = 'available'
            AND (p_client_id IS NOT NULL OR p_plant_id IS NOT NULL) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        IF p_client_id IS NOT NULL THEN
            PERFORM 1 FROM public.clients WHERE id = p_client_id FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
        END IF;
        IF p_plant_id IS NOT NULL THEN
            PERFORM 1 FROM public.plants WHERE id = p_plant_id FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
        END IF;

        IF p_source_status = 'available' THEN
            IF v_available < p_quantity THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_STOCK';
            END IF;
        ELSE
            IF p_client_id IS NULL AND p_plant_id IS NULL THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
            SELECT COALESCE(
                SUM(CASE WHEN movement.to_status = p_source_status THEN movement.quantity ELSE 0 END)
                - SUM(CASE WHEN movement.from_status = p_source_status THEN movement.quantity ELSE 0 END),
                0
            )
            INTO v_scoped_balance
            FROM public.inventory_movements AS movement
            WHERE movement.product_id = p_product_id
              AND movement.client_id IS NOT DISTINCT FROM p_client_id
              AND movement.plant_id IS NOT DISTINCT FROM p_plant_id;
            IF v_scoped_balance < p_quantity THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_STOCK';
            END IF;
        END IF;
        v_from_status := p_source_status;
        v_to_status := 'written_off';

    ELSE
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRANSITION';
    END IF;

    INSERT INTO public.inventory_movements (
        product_id, item_id, movement_type, quantity, from_status, to_status,
        client_id, plant_id, device_id, notes, created_by,
        inventory_operation_id, inventory_operation_line_id
    ) VALUES (
        p_product_id, NULL, p_movement_type, p_quantity,
        v_from_status, v_to_status, p_client_id, p_plant_id, NULL,
        p_notes, p_created_by,
        p_inventory_operation_id, p_inventory_operation_line_id
    )
    RETURNING * INTO v_movement;

    RETURN v_movement;
END;
$$;

DROP FUNCTION public.inventory_dispatch_quantity(uuid, numeric, uuid, text, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.inventory_dispatch_quantity(
    p_product_id uuid,
    p_quantity numeric,
    p_plant_id uuid DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_created_by uuid DEFAULT NULL,
    p_material_request_id uuid DEFAULT NULL,
    p_material_request_line_id uuid DEFAULT NULL,
    p_inventory_operation_id uuid DEFAULT NULL,
    p_inventory_operation_line_id uuid DEFAULT NULL
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
        material_request_id, material_request_line_id,
        inventory_operation_id, inventory_operation_line_id
    ) VALUES (
        p_product_id, NULL, 'dispatch', p_quantity, 'available', 'dispatched',
        NULL, p_plant_id, NULL, p_notes, p_created_by,
        p_material_request_id, p_material_request_line_id,
        p_inventory_operation_id, p_inventory_operation_line_id
    )
    RETURNING * INTO v_movement;

    RETURN v_movement;
END;
$$;

DROP FUNCTION public.inventory_record_quantity_movement(uuid, text, numeric, text, uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.inventory_record_quantity_movement(
    p_product_id uuid,
    p_movement_type text,
    p_quantity numeric,
    p_source_status text DEFAULT NULL,
    p_client_id uuid DEFAULT NULL,
    p_plant_id uuid DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_created_by uuid DEFAULT NULL,
    p_inventory_operation_id uuid DEFAULT NULL,
    p_inventory_operation_line_id uuid DEFAULT NULL
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
            p_product_id, p_quantity, p_plant_id, p_notes, p_created_by, NULL, NULL,
            p_inventory_operation_id, p_inventory_operation_line_id
        );
    END IF;

    RETURN public.inventory_record_quantity_movement_legacy_026(
        p_product_id, p_movement_type, p_quantity, p_source_status,
        p_client_id, p_plant_id, p_notes, p_created_by,
        p_inventory_operation_id, p_inventory_operation_line_id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.inventory_create_serialized_item(uuid, text, text, uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inventory_record_quantity_movement_legacy_026(uuid, text, numeric, text, uuid, uuid, text, uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inventory_dispatch_quantity(uuid, numeric, uuid, text, uuid, uuid, uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inventory_record_quantity_movement(uuid, text, numeric, text, uuid, uuid, text, uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.inventory_create_serialized_item(uuid, text, text, uuid, uuid, uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_record_quantity_movement_legacy_026(uuid, text, numeric, text, uuid, uuid, text, uuid, uuid, uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_dispatch_quantity(uuid, numeric, uuid, text, uuid, uuid, uuid, uuid, uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_record_quantity_movement(uuid, text, numeric, text, uuid, uuid, text, uuid, uuid, uuid)
TO service_role;

-- RPC: crea cabecera draft + líneas SIN modificar stock, items ni
-- movimientos. Autorización: rdx_admin siempre; client_admin solo con
-- módulo inventory (mismo criterio que requireModuleAccess para no admin).
-- Idempotencia de CREATE: p_idempotency_key devuelve la operación
-- existente sin duplicar; es independiente de las futuras claves de
-- confirm/cancel (fase 3).
CREATE OR REPLACE FUNCTION public.inventory_operation_create(
    p_actor_id uuid,
    p_operation_type text,
    p_lines jsonb,
    p_operation_date date DEFAULT CURRENT_DATE,
    p_reference text DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_idempotency_key uuid DEFAULT NULL
)
RETURNS public.inventory_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_role text;
    v_modules text[];
    v_operation public.inventory_operations%ROWTYPE;
    v_line jsonb;
    v_product_id uuid;
    v_quantity numeric;
    v_tracking_mode text;
    v_product_active boolean;
    v_serials jsonb;
    v_serial_element jsonb;
    v_serial text;
    v_normalized text[];
    v_all_serials text[] := '{}';
    v_norm_serials jsonb := '[]'::jsonb;
    v_index integer := 0;
BEGIN
    SELECT profile.role, profile.module_permissions
    INTO v_role, v_modules
    FROM public.user_profiles AS profile
    WHERE profile.id = p_actor_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTOR_NOT_FOUND';
    END IF;
    IF v_role IS DISTINCT FROM 'rdx_admin'
        AND (v_role IS DISTINCT FROM 'client_admin'
            OR NOT ('inventory' = ANY (COALESCE(v_modules, '{}')))) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCESS_DENIED';
    END IF;

    IF p_operation_type NOT IN ('IN', 'ADJUST_IN', 'ADJUST_OUT') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_OPERATION_TYPE';
    END IF;

    IF p_lines IS NULL
        OR pg_catalog.jsonb_typeof(p_lines) <> 'array'
        OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_OPERATION_LINES';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT operation.* INTO v_operation
        FROM public.inventory_operations AS operation
        WHERE operation.create_idempotency_key = p_idempotency_key;
        IF FOUND THEN
            RETURN v_operation;
        END IF;
    END IF;

    BEGIN
        IF EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements(p_lines) AS entry(value)
            GROUP BY (entry.value ->> 'product_id')::uuid
            HAVING count(*) > 1
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DUPLICATE_OPERATION_PRODUCT';
        END IF;
    EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_OPERATION_LINES';
    END;

    INSERT INTO public.inventory_operations (
        operation_type, operation_date, reference, notes, created_by,
        create_idempotency_key
    ) VALUES (
        p_operation_type, p_operation_date, NULLIF(pg_catalog.btrim(COALESCE(p_reference, '')), ''),
        NULLIF(pg_catalog.btrim(COALESCE(p_notes, '')), ''), p_actor_id,
        p_idempotency_key
    )
    RETURNING * INTO v_operation;

    FOR v_line IN
        SELECT entry.value
        FROM pg_catalog.jsonb_array_elements(p_lines) AS entry(value)
    LOOP
        IF pg_catalog.jsonb_typeof(v_line) <> 'object' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_OPERATION_LINES';
        END IF;
        BEGIN
            v_product_id := (v_line ->> 'product_id')::uuid;
            v_quantity := (v_line ->> 'quantity')::numeric;
        EXCEPTION
            WHEN invalid_text_representation OR numeric_value_out_of_range THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_OPERATION_LINES';
        END;

        IF v_product_id IS NULL OR v_quantity IS NULL
            OR v_quantity <= 0
            OR v_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_OPERATION_LINES';
        END IF;

        SELECT product.tracking_mode, product.active
        INTO v_tracking_mode, v_product_active
        FROM public.inventory_products AS product
        WHERE product.id = v_product_id
        FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRODUCT_NOT_FOUND';
        END IF;
        IF NOT v_product_active THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INACTIVE_PRODUCT';
        END IF;

        v_serials := v_line -> 'serial_numbers';
        v_normalized := '{}';
        v_norm_serials := '[]'::jsonb;

        IF v_tracking_mode = 'quantity' THEN
            IF v_serials IS NOT NULL
                AND (pg_catalog.jsonb_typeof(v_serials) <> 'array'
                    OR pg_catalog.jsonb_array_length(v_serials) <> 0) THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SERIAL_NUMBERS';
            END IF;
        ELSIF v_tracking_mode = 'serialized' THEN
            IF p_operation_type <> 'IN' THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRACKING_MODE';
            END IF;
            IF v_quantity <> pg_catalog.trunc(v_quantity) THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_QUANTITY';
            END IF;
            IF v_serials IS NULL OR pg_catalog.jsonb_typeof(v_serials) <> 'array'
                OR pg_catalog.jsonb_array_length(v_serials) <> v_quantity::integer THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SERIAL_NUMBERS';
            END IF;
            FOR v_serial_element IN
                SELECT entry.value
                FROM pg_catalog.jsonb_array_elements(v_serials) AS entry(value)
            LOOP
                IF pg_catalog.jsonb_typeof(v_serial_element) <> 'string' THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SERIAL_NUMBERS';
                END IF;
                v_serial := pg_catalog.upper(pg_catalog.btrim(v_serial_element #>> '{}'));
                IF v_serial IS NULL OR v_serial = '' THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SERIAL_NUMBERS';
                END IF;
                IF v_serial = ANY (v_normalized) OR v_serial = ANY (v_all_serials) THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DUPLICATE_SERIAL_NUMBER';
                END IF;
                v_normalized := v_normalized || v_serial;
                v_norm_serials := v_norm_serials || pg_catalog.to_jsonb(v_serial);
            END LOOP;
            v_all_serials := v_all_serials || v_normalized;
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRACKING_MODE';
        END IF;

        INSERT INTO public.inventory_operation_lines (
            operation_id, product_id, quantity, serial_numbers, notes, line_order
        ) VALUES (
            v_operation.id, v_product_id, v_quantity,
            CASE WHEN v_tracking_mode = 'serialized' THEN v_norm_serials ELSE NULL END,
            NULLIF(pg_catalog.btrim(COALESCE(v_line ->> 'notes', '')), ''), v_index
        );
        v_index := v_index + 1;
    END LOOP;

    -- Fail-fast: ningún serial del documento puede existir ya en inventario.
    -- La confirmación futura revalida obligatoriamente + UNIQUE final.
    IF v_all_serials <> '{}'
        AND EXISTS (
            SELECT 1 FROM public.inventory_items AS item
            WHERE item.serial_number = ANY (v_all_serials)
        ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SERIAL_ALREADY_EXISTS';
    END IF;

    RETURN v_operation;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.inventory_operation_create(uuid, text, jsonb, date, text, text, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.inventory_operation_create(uuid, text, jsonb, date, text, text, uuid)
TO service_role;

-- Fase 3: confirmación y cancelación atómicas.
--
-- Cada acción usa exclusivamente su propia clave de idempotencia
-- (create/confirm/cancel independientes, UNIQUE y NULLables).
-- La transición draft → confirmed / draft → cancelled tiene
-- OLD.status = 'draft', por lo que los triggers de inmutabilidad de la
-- fase 1 la permiten sin bypass. Una vez confirmed/cancelled, el retry
-- idempotente solo retorna sin modificar (los triggers bloquearían
-- cualquier UPDATE posterior).

ALTER TABLE public.inventory_operations
    ADD COLUMN confirm_idempotency_key uuid UNIQUE,
    ADD COLUMN cancel_idempotency_key uuid UNIQUE;

CREATE OR REPLACE FUNCTION public.inventory_operation_confirm(
    p_operation_id uuid,
    p_actor_id uuid,
    p_idempotency_key uuid
)
RETURNS public.inventory_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_role text;
    v_modules text[];
    v_operation public.inventory_operations%ROWTYPE;
    v_conflict uuid;
    v_line record;
    v_tracking_mode text;
    v_product_active boolean;
    v_serials jsonb;
    v_serial_element jsonb;
    v_serial text;
    v_normalized text[];
    v_all_serials text[] := '{}';
    v_norm_serials jsonb;
    v_available numeric;
    v_movement_type text;
BEGIN
    SELECT profile.role, profile.module_permissions
    INTO v_role, v_modules
    FROM public.user_profiles AS profile
    WHERE profile.id = p_actor_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTOR_NOT_FOUND';
    END IF;
    IF v_role IS DISTINCT FROM 'rdx_admin'
        AND (v_role IS DISTINCT FROM 'client_admin'
            OR NOT ('inventory' = ANY (COALESCE(v_modules, '{}')))) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCESS_DENIED';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_IDEMPOTENCY_KEY';
    END IF;

    SELECT operation.* INTO v_operation
    FROM public.inventory_operations AS operation
    WHERE operation.id = p_operation_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPERATION_NOT_FOUND';
    END IF;

    IF v_operation.status = 'confirmed' THEN
        IF v_operation.confirm_idempotency_key IS NOT DISTINCT FROM p_idempotency_key THEN
            RETURN v_operation;
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_CONFIRMED';
    END IF;
    IF v_operation.status = 'cancelled' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_STATUS';
    END IF;
    IF v_operation.status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_STATUS';
    END IF;

    SELECT operation.id INTO v_conflict
    FROM public.inventory_operations AS operation
    WHERE operation.confirm_idempotency_key = p_idempotency_key
      AND operation.id IS DISTINCT FROM p_operation_id;
    IF FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IDEMPOTENCY_CONFLICT';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.inventory_operation_lines AS line
        WHERE line.operation_id = p_operation_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_OPERATION_LINES';
    END IF;

    -- Revalidación completa ANTES de mutar (el draft pudo permanecer abierto).
    FOR v_line IN
        SELECT line.*
        FROM public.inventory_operation_lines AS line
        WHERE line.operation_id = p_operation_id
        ORDER BY line.line_order, line.id
    LOOP
        SELECT product.tracking_mode, product.active
        INTO v_tracking_mode, v_product_active
        FROM public.inventory_products AS product
        WHERE product.id = v_line.product_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRODUCT_NOT_FOUND';
        END IF;
        IF NOT v_product_active THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INACTIVE_PRODUCT';
        END IF;
        IF v_line.quantity IS NULL OR v_line.quantity <= 0
            OR v_line.quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_QUANTITY';
        END IF;

        v_serials := v_line.serial_numbers;
        v_normalized := '{}';
        v_norm_serials := '[]'::jsonb;

        IF v_tracking_mode = 'quantity' THEN
            IF v_operation.operation_type NOT IN ('IN', 'ADJUST_IN', 'ADJUST_OUT') THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_OPERATION_TYPE';
            END IF;
            IF v_serials IS NOT NULL
                AND (pg_catalog.jsonb_typeof(v_serials) <> 'array'
                    OR pg_catalog.jsonb_array_length(v_serials) <> 0) THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SERIAL_NUMBERS';
            END IF;
        ELSIF v_tracking_mode = 'serialized' THEN
            IF v_operation.operation_type <> 'IN' THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRACKING_MODE';
            END IF;
            IF v_line.quantity <> pg_catalog.trunc(v_line.quantity) THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_QUANTITY';
            END IF;
            IF v_serials IS NULL OR pg_catalog.jsonb_typeof(v_serials) <> 'array'
                OR pg_catalog.jsonb_array_length(v_serials) <> v_line.quantity::integer THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SERIAL_NUMBERS';
            END IF;
            FOR v_serial_element IN
                SELECT entry.value
                FROM pg_catalog.jsonb_array_elements(v_serials) AS entry(value)
            LOOP
                IF pg_catalog.jsonb_typeof(v_serial_element) <> 'string' THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SERIAL_NUMBERS';
                END IF;
                v_serial := pg_catalog.upper(pg_catalog.btrim(v_serial_element #>> '{}'));
                IF v_serial IS NULL OR v_serial = '' THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SERIAL_NUMBERS';
                END IF;
                IF v_serial = ANY (v_normalized) OR v_serial = ANY (v_all_serials) THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DUPLICATE_SERIAL_NUMBER';
                END IF;
                v_normalized := v_normalized || v_serial;
                v_norm_serials := v_norm_serials || pg_catalog.to_jsonb(v_serial);
            END LOOP;
            v_all_serials := v_all_serials || v_normalized;
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRACKING_MODE';
        END IF;
    END LOOP;

    IF v_all_serials <> '{}'
        AND EXISTS (
            SELECT 1 FROM public.inventory_items AS item
            WHERE item.serial_number = ANY (v_all_serials)
        ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SERIAL_ALREADY_EXISTS';
    END IF;

    -- Bloqueo determinista de productos (mismo mutex que las RPC de
    -- cantidad). Ordenado por product_id, nunca por orden visual.
    FOR v_line IN
        SELECT DISTINCT line.product_id
        FROM public.inventory_operation_lines AS line
        WHERE line.operation_id = p_operation_id
        ORDER BY line.product_id
    LOOP
        PERFORM 1
        FROM public.inventory_products AS product
        WHERE product.id = v_line.product_id
        FOR UPDATE;
    END LOOP;

    -- Fail-fast ADJUST_OUT: stock suficiente en TODAS las líneas antes del
    -- primer movimiento (la transacción igualmente haría rollback).
    FOR v_line IN
        SELECT line.*
        FROM public.inventory_operation_lines AS line
        JOIN public.inventory_products AS product ON product.id = line.product_id
        WHERE line.operation_id = p_operation_id
          AND v_operation.operation_type = 'ADJUST_OUT'
          AND product.tracking_mode = 'quantity'
    LOOP
        SELECT COALESCE(
            SUM(CASE WHEN movement.to_status = 'available' THEN movement.quantity ELSE 0 END)
            - SUM(CASE WHEN movement.from_status = 'available' THEN movement.quantity ELSE 0 END),
            0
        )
        INTO v_available
        FROM public.inventory_movements AS movement
        WHERE movement.product_id = v_line.product_id;
        IF v_available < v_line.quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_STOCK';
        END IF;
    END LOOP;

    -- Mutación: una línea por producto (UNIQUE), mismo orden de líneas.
    FOR v_line IN
        SELECT line.*, product.tracking_mode
        FROM public.inventory_operation_lines AS line
        JOIN public.inventory_products AS product ON product.id = line.product_id
        WHERE line.operation_id = p_operation_id
        ORDER BY line.line_order, line.id
    LOOP
        IF v_line.tracking_mode = 'quantity' THEN
            v_movement_type := CASE v_operation.operation_type
                WHEN 'IN' THEN 'in'
                WHEN 'ADJUST_IN' THEN 'adjust_in'
                ELSE 'adjust_out'
            END;
            PERFORM public.inventory_record_quantity_movement(
                v_line.product_id, v_movement_type, v_line.quantity,
                NULL, NULL, NULL, v_line.notes, p_actor_id,
                p_operation_id, v_line.id
            );
        ELSE
            FOR v_serial_element IN
                SELECT entry.value
                FROM pg_catalog.jsonb_array_elements(
                    (SELECT line.serial_numbers
                     FROM public.inventory_operation_lines AS line
                     WHERE line.id = v_line.id)
                ) AS entry(value)
            LOOP
                PERFORM public.inventory_create_serialized_item(
                    v_line.product_id, v_serial_element #>> '{}',
                    v_line.notes, p_actor_id,
                    p_operation_id, v_line.id
                );
            END LOOP;
        END IF;
    END LOOP;

    UPDATE public.inventory_operations
    SET status = 'confirmed',
        confirmed_by = p_actor_id,
        confirmed_at = pg_catalog.now(),
        confirm_idempotency_key = p_idempotency_key,
        updated_at = pg_catalog.now()
    WHERE id = p_operation_id
    RETURNING * INTO v_operation;

    RETURN v_operation;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.inventory_operation_confirm(uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.inventory_operation_confirm(uuid, uuid, uuid)
TO service_role;

CREATE OR REPLACE FUNCTION public.inventory_operation_cancel(
    p_operation_id uuid,
    p_actor_id uuid,
    p_idempotency_key uuid
)
RETURNS public.inventory_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_role text;
    v_modules text[];
    v_operation public.inventory_operations%ROWTYPE;
    v_conflict uuid;
BEGIN
    SELECT profile.role, profile.module_permissions
    INTO v_role, v_modules
    FROM public.user_profiles AS profile
    WHERE profile.id = p_actor_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTOR_NOT_FOUND';
    END IF;
    IF v_role IS DISTINCT FROM 'rdx_admin'
        AND (v_role IS DISTINCT FROM 'client_admin'
            OR NOT ('inventory' = ANY (COALESCE(v_modules, '{}')))) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCESS_DENIED';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_IDEMPOTENCY_KEY';
    END IF;

    SELECT operation.* INTO v_operation
    FROM public.inventory_operations AS operation
    WHERE operation.id = p_operation_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPERATION_NOT_FOUND';
    END IF;

    IF v_operation.status = 'cancelled' THEN
        IF v_operation.cancel_idempotency_key IS NOT DISTINCT FROM p_idempotency_key THEN
            RETURN v_operation;
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_CANCELLED';
    END IF;
    IF v_operation.status = 'confirmed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_CONFIRMED';
    END IF;
    IF v_operation.status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_STATUS';
    END IF;

    SELECT operation.id INTO v_conflict
    FROM public.inventory_operations AS operation
    WHERE operation.cancel_idempotency_key = p_idempotency_key
      AND operation.id IS DISTINCT FROM p_operation_id;
    IF FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IDEMPOTENCY_CONFLICT';
    END IF;

    UPDATE public.inventory_operations
    SET status = 'cancelled',
        cancelled_by = p_actor_id,
        cancelled_at = pg_catalog.now(),
        cancel_idempotency_key = p_idempotency_key,
        updated_at = pg_catalog.now()
    WHERE id = p_operation_id
    RETURNING * INTO v_operation;

    RETURN v_operation;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.inventory_operation_cancel(uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.inventory_operation_cancel(uuid, uuid, uuid)
TO service_role;

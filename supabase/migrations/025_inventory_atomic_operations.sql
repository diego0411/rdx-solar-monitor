-- Inventario V1: operaciones de stock atomicas para uso exclusivo del backend.
-- Las funciones usan SECURITY INVOKER: service_role conserva sus privilegios
-- normales y bypass de RLS, sin elevar a los privilegios del propietario.

CREATE OR REPLACE FUNCTION public.inventory_create_serialized_item(
    p_product_id uuid,
    p_serial_number text,
    p_notes text DEFAULT NULL,
    p_created_by uuid DEFAULT NULL
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
        client_id, plant_id, device_id, notes, created_by
    ) VALUES (
        p_product_id, v_item.id, 'in', 1, NULL, 'available',
        NULL, NULL, NULL, p_notes, p_created_by
    );

    RETURN v_item;
END;
$$;

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
    v_item public.inventory_items%ROWTYPE;
    v_from_status text;
    v_next_status text;
    v_movement_client_id uuid;
    v_movement_plant_id uuid;
    v_movement_device_id uuid;
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
    v_movement_client_id := v_item.client_id;
    v_movement_plant_id := v_item.plant_id;
    v_movement_device_id := v_item.device_id;

    IF v_item.status = 'available' AND p_movement_type = 'assign' THEN
        IF p_client_id IS NULL OR p_plant_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        IF p_device_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRANSITION';
        END IF;
        PERFORM 1 FROM public.clients WHERE id = p_client_id FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        PERFORM 1 FROM public.plants WHERE id = p_plant_id FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        PERFORM 1
        FROM public.client_plants AS assignment
        WHERE assignment.client_id = p_client_id
          AND assignment.plant_id = p_plant_id
        FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;

        v_next_status := 'assigned';
        v_movement_client_id := p_client_id;
        v_movement_plant_id := p_plant_id;
        v_movement_device_id := NULL;

        UPDATE public.inventory_items
        SET status = v_next_status,
            client_id = v_movement_client_id,
            plant_id = v_movement_plant_id,
            device_id = NULL,
            updated_at = pg_catalog.now()
        WHERE id = v_item.id
        RETURNING * INTO v_item;

    ELSIF v_item.status = 'assigned' AND p_movement_type = 'install' THEN
        IF v_item.client_id IS NULL OR v_item.plant_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        PERFORM 1 FROM public.clients WHERE id = v_item.client_id FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        PERFORM 1 FROM public.plants WHERE id = v_item.plant_id FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        PERFORM 1
        FROM public.client_plants AS assignment
        WHERE assignment.client_id = v_item.client_id
          AND assignment.plant_id = v_item.plant_id
        FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        IF (p_client_id IS NOT NULL AND p_client_id IS DISTINCT FROM v_item.client_id)
            OR (p_plant_id IS NOT NULL AND p_plant_id IS DISTINCT FROM v_item.plant_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        IF p_device_id IS NOT NULL THEN
            SELECT device.plant_id
            INTO v_device_plant_id
            FROM public.devices AS device
            WHERE device.id = p_device_id
            FOR KEY SHARE;
            IF NOT FOUND OR v_device_plant_id IS DISTINCT FROM v_item.plant_id THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DEVICE_PLANT_MISMATCH';
            END IF;
        END IF;

        v_next_status := 'installed';
        v_movement_device_id := p_device_id;

        UPDATE public.inventory_items
        SET status = v_next_status,
            device_id = v_movement_device_id,
            updated_at = pg_catalog.now()
        WHERE id = v_item.id
        RETURNING * INTO v_item;

    ELSIF v_item.status = 'assigned' AND p_movement_type = 'return' THEN
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

    ELSIF v_item.status IN ('available', 'assigned') AND p_movement_type = 'sell' THEN
        v_next_status := 'sold';

        IF v_item.status = 'available' THEN
            IF (p_client_id IS NULL) <> (p_plant_id IS NULL) THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
            IF p_device_id IS NOT NULL THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRANSITION';
            END IF;
            IF p_client_id IS NOT NULL THEN
                PERFORM 1 FROM public.clients WHERE id = p_client_id FOR KEY SHARE;
                IF NOT FOUND THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
                END IF;
                PERFORM 1 FROM public.plants WHERE id = p_plant_id FOR KEY SHARE;
                IF NOT FOUND THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
                END IF;
                PERFORM 1
                FROM public.client_plants AS assignment
                WHERE assignment.client_id = p_client_id
                  AND assignment.plant_id = p_plant_id
                FOR KEY SHARE;
                IF NOT FOUND THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
                END IF;
            END IF;
            v_movement_client_id := p_client_id;
            v_movement_plant_id := p_plant_id;
            v_movement_device_id := NULL;
        ELSE
            IF (p_client_id IS NOT NULL AND p_client_id IS DISTINCT FROM v_item.client_id)
                OR (p_plant_id IS NOT NULL AND p_plant_id IS DISTINCT FROM v_item.plant_id)
                OR (p_device_id IS NOT NULL AND p_device_id IS DISTINCT FROM v_item.device_id) THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRANSITION';
            END IF;
        END IF;

        UPDATE public.inventory_items
        SET status = v_next_status,
            client_id = v_movement_client_id,
            plant_id = v_movement_plant_id,
            device_id = v_movement_device_id,
            updated_at = pg_catalog.now()
        WHERE id = v_item.id
        RETURNING * INTO v_item;

    ELSIF v_item.status IN ('available', 'assigned', 'installed')
        AND p_movement_type = 'write_off' THEN
        IF (p_client_id IS NOT NULL AND p_client_id IS DISTINCT FROM v_item.client_id)
            OR (p_plant_id IS NOT NULL AND p_plant_id IS DISTINCT FROM v_item.plant_id)
            OR (p_device_id IS NOT NULL AND p_device_id IS DISTINCT FROM v_item.device_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRANSITION';
        END IF;

        v_next_status := 'written_off';

        UPDATE public.inventory_items
        SET status = v_next_status,
            updated_at = pg_catalog.now()
        WHERE id = v_item.id
        RETURNING * INTO v_item;

    ELSE
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRANSITION';
    END IF;

    INSERT INTO public.inventory_movements (
        product_id, item_id, movement_type, quantity, from_status, to_status,
        client_id, plant_id, device_id, notes, created_by
    ) VALUES (
        v_item.product_id, v_item.id, p_movement_type, 1,
        v_from_status,
        v_next_status,
        v_movement_client_id, v_movement_plant_id, v_movement_device_id,
        p_notes, p_created_by
    );

    RETURN v_item;
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
        IF p_client_id IS NULL OR p_plant_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        PERFORM 1 FROM public.clients WHERE id = p_client_id FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        PERFORM 1 FROM public.plants WHERE id = p_plant_id FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        PERFORM 1
        FROM public.client_plants AS assignment
        WHERE assignment.client_id = p_client_id
          AND assignment.plant_id = p_plant_id
        FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
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
        IF p_client_id IS NULL OR p_plant_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        PERFORM 1 FROM public.clients WHERE id = p_client_id FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        PERFORM 1 FROM public.plants WHERE id = p_plant_id FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        PERFORM 1
        FROM public.client_plants AS assignment
        WHERE assignment.client_id = p_client_id
          AND assignment.plant_id = p_plant_id
        FOR KEY SHARE;
        IF NOT FOUND THEN
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
          AND movement.client_id = p_client_id
          AND movement.plant_id = p_plant_id;

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
        IF (p_client_id IS NULL) <> (p_plant_id IS NULL) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        IF p_client_id IS NOT NULL THEN
            PERFORM 1 FROM public.clients WHERE id = p_client_id FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
            PERFORM 1 FROM public.plants WHERE id = p_plant_id FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
            PERFORM 1
            FROM public.client_plants AS assignment
            WHERE assignment.client_id = p_client_id
              AND assignment.plant_id = p_plant_id
            FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
        END IF;

        IF p_source_status = 'available' THEN
            IF v_available < p_quantity THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_STOCK';
            END IF;
        ELSE
            IF p_client_id IS NULL THEN
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
              AND movement.client_id = p_client_id
              AND movement.plant_id = p_plant_id;
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
        IF (p_client_id IS NULL) <> (p_plant_id IS NULL) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        IF p_client_id IS NOT NULL THEN
            PERFORM 1 FROM public.clients WHERE id = p_client_id FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
            PERFORM 1 FROM public.plants WHERE id = p_plant_id FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
            PERFORM 1
            FROM public.client_plants AS assignment
            WHERE assignment.client_id = p_client_id
              AND assignment.plant_id = p_plant_id
            FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
        END IF;

        IF p_source_status = 'available' THEN
            IF v_available < p_quantity THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_STOCK';
            END IF;
        ELSE
            IF p_client_id IS NULL THEN
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
              AND movement.client_id = p_client_id
              AND movement.plant_id = p_plant_id;
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
        client_id, plant_id, device_id, notes, created_by
    ) VALUES (
        p_product_id, NULL, p_movement_type, p_quantity,
        v_from_status, v_to_status, p_client_id, p_plant_id, NULL,
        p_notes, p_created_by
    )
    RETURNING * INTO v_movement;

    RETURN v_movement;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.inventory_create_serialized_item(uuid, text, text, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inventory_transition_serialized_item(uuid, text, uuid, uuid, uuid, text, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inventory_record_quantity_movement(uuid, text, numeric, text, uuid, uuid, text, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.inventory_create_serialized_item(uuid, text, text, uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_transition_serialized_item(uuid, text, uuid, uuid, uuid, text, uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_record_quantity_movement(uuid, text, numeric, text, uuid, uuid, text, uuid)
TO service_role;

-- Inventario: client_id comercial y plant_id independientes (sin client_plants).
--
-- Reemplaza el archivo pendiente 026_retire_nexora_bootstrap.sql, que nunca fue
-- aplicado ni committed y respondía al modelo anterior (Nexora como cliente).
-- Decisión arquitectónica vigente:
-- - CLIENTE = entidad comercial (a quién se asigna/instala/vende equipo).
-- - PLANTA = entidad independiente de monitoreo.
-- - En Inventario client_id y plant_id son opcionales e independientes:
--   (NULL, NULL) stock general; (cliente, NULL); (NULL, planta);
--   (cliente, planta). La existencia de ambos NO exige client_plants.
--
-- Alcance (solo esto):
-- 1. enforce_inventory_structure() (de 024): la pareja (client_id, plant_id)
--    deja de validarse contra client_plants; cada ID se valida por separado
--    contra clients/plants. Además: items con status installed exigen
--    plant_id NOT NULL. Demás reglas intactas.
-- 2. inventory_transition_serialized_item() e
--    inventory_record_quantity_movement() (de 025): las ramas assign/install/
--    sell/write_off validan client_id y plant_id individualmente; se elimina
--    la exigencia del par en client_plants y la regla ambos-o-ninguno.
--    Reglas operacionales nuevas:
--    - installed siempre tiene planta: install la conserva o la completa
--      (cambiarla es error); quantity install exige plant_id.
--    - un client_id NUEVO (assign, sell desde available) exige clients.active;
--      el historial con clientes luego desactivados se preserva sin checks.
--    Máquina de estados, balances, append-only y demás códigos intactos.
--
-- Fuera de alcance (intencional, autorización transitoria):
-- - NO toca clients (Nexora sigue active), client_plants (19 vínculos intactos),
--   user_profiles, roles ni authorization.middleware (loadProfile/plantInScope).
-- - client_plants queda CONGELADA para autorización legacy: sin nuevos writes
--   comerciales desde Clientes, pero con lecturas de scope intactas.
-- - NO toca 024 ni 025 (CREATE OR REPLACE, privilegios existentes intactos).

-- 1. Trigger: validación referencial independiente.
CREATE OR REPLACE FUNCTION public.enforce_inventory_structure()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    item_product_id uuid;
    product_mode text;
BEGIN
    -- Items solo para productos serialized.
    IF TG_TABLE_NAME = 'inventory_items' THEN
        SELECT tracking_mode INTO product_mode
        FROM public.inventory_products
        WHERE id = NEW.product_id;
        IF product_mode IS DISTINCT FROM 'serialized' THEN
            RAISE EXCEPTION 'inventory_items solo admite productos serialized'
                USING ERRCODE = '23514';
        END IF;
        -- Referencias independientes: client_id comercial y plant_id se validan
        -- por separado. NO se exige pareja en client_plants.
        -- Regla operacional (no de historial): installed siempre tiene planta.
        IF NEW.status = 'installed' AND NEW.plant_id IS NULL THEN
            RAISE EXCEPTION 'installed exige plant_id'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.client_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = NEW.client_id) THEN
            RAISE EXCEPTION 'client_id no existe en clients'
                USING ERRCODE = '23503';
        END IF;
        IF NEW.plant_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.plants WHERE id = NEW.plant_id) THEN
            RAISE EXCEPTION 'plant_id no existe en plants'
                USING ERRCODE = '23503';
        END IF;
        RETURN NEW;
    END IF;

    -- Movements: serialized exige item_id + quantity 1; quantity exige
    -- item_id NULL; el item debe pertenecer al mismo producto.
    IF TG_TABLE_NAME = 'inventory_movements' THEN
        SELECT tracking_mode INTO product_mode
        FROM public.inventory_products
        WHERE id = NEW.product_id;
        IF product_mode = 'serialized' THEN
            IF NEW.item_id IS NULL OR NEW.quantity <> 1 THEN
                RAISE EXCEPTION 'producto serialized exige item_id y quantity = 1'
                    USING ERRCODE = '23514';
            END IF;
            SELECT product_id INTO item_product_id
            FROM public.inventory_items
            WHERE id = NEW.item_id;
            IF item_product_id IS DISTINCT FROM NEW.product_id THEN
                RAISE EXCEPTION 'item_id no pertenece al product_id del movimiento'
                    USING ERRCODE = '23503';
            END IF;
        ELSIF product_mode = 'quantity' THEN
            IF NEW.item_id IS NOT NULL THEN
                RAISE EXCEPTION 'producto quantity no admite item_id'
                    USING ERRCODE = '23514';
            END IF;
        ELSE
            RAISE EXCEPTION 'product_id de movimiento inválido'
                USING ERRCODE = '23503';
        END IF;
        -- Referencias independientes (igual que items).
        IF NEW.client_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = NEW.client_id) THEN
            RAISE EXCEPTION 'client_id no existe en clients'
                USING ERRCODE = '23503';
        END IF;
        IF NEW.plant_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.plants WHERE id = NEW.plant_id) THEN
            RAISE EXCEPTION 'plant_id no existe en plants'
                USING ERRCODE = '23503';
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

-- 2a. RPC serialized: contexto comercial/geográfico independiente.
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
    v_client_active boolean;
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
        -- Assign admite cliente solo, planta solo o ambos (al menos uno).
        -- Un cliente NUEVO debe existir y estar activo (regla operacional;
        -- el historial con clientes luego desactivados se preserva).
        IF p_client_id IS NULL AND p_plant_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        IF p_device_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRANSITION';
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
        -- installed exige planta final: se conserva la existente o se completa
        -- la faltante; cambiarla es error. El cliente se preserva sin cambios
        -- (no se introduce cliente nuevo durante install).
        IF v_item.client_id IS NULL AND v_item.plant_id IS NULL AND p_plant_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        IF v_item.client_id IS NOT NULL THEN
            PERFORM 1 FROM public.clients WHERE id = v_item.client_id FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
        END IF;
        IF v_item.plant_id IS NOT NULL THEN
            PERFORM 1 FROM public.plants WHERE id = v_item.plant_id FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
            IF p_plant_id IS NOT NULL AND p_plant_id IS DISTINCT FROM v_item.plant_id THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
        ELSE
            IF p_plant_id IS NULL THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
            PERFORM 1 FROM public.plants WHERE id = p_plant_id FOR KEY SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
            END IF;
        END IF;
        IF p_client_id IS NOT NULL AND p_client_id IS DISTINCT FROM v_item.client_id THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_CLIENT_PLANT';
        END IF;
        IF p_device_id IS NOT NULL THEN
            SELECT device.plant_id
            INTO v_device_plant_id
            FROM public.devices AS device
            WHERE device.id = p_device_id
            FOR KEY SHARE;
            IF NOT FOUND
                OR v_device_plant_id IS DISTINCT FROM COALESCE(v_item.plant_id, p_plant_id) THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DEVICE_PLANT_MISMATCH';
            END IF;
        END IF;

        v_next_status := 'installed';
        v_movement_plant_id := COALESCE(v_item.plant_id, p_plant_id);
        v_movement_device_id := p_device_id;

        UPDATE public.inventory_items
        SET status = v_next_status,
            plant_id = v_movement_plant_id,
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
            -- Contexto de venta opcional: ninguno, cliente solo, planta solo
            -- o ambos. Cada ID se valida por separado.
            IF p_device_id IS NOT NULL THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TRANSITION';
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

-- 2b. RPC quantity: contexto comercial/geográfico independiente.
-- Los balances por alcance comparan con IS NOT DISTINCT FROM para que el
-- contexto parcial (solo cliente o solo planta) delimite su propio saldo.
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

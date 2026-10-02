-- Operaciones: cliente comercial destino opcional en solicitudes.
--
-- 031 congelada: no se edita. Esta migración agrega la columna
-- destination_client_id y reemplaza material_request_create con la misma
-- firma + un parámetro opcional nuevo (compatibilidad hacia atrás: las
-- llamadas antiguas sin el parámetro siguen funcionando).
-- Sin backfill ni inferencias: las solicitudes existentes quedan NULL.
-- Sin cambios de RLS: la columna vive en material_requests, cubierta por
-- las políticas/privilegios ya definidos en 031; el INSERT sigue
-- ocurriendo solo vía RPC SECURITY DEFINER.

ALTER TABLE public.material_requests
    ADD COLUMN destination_client_id uuid NULL
        REFERENCES public.clients(id) ON DELETE RESTRICT;

CREATE INDEX material_requests_destination_client_id_idx
    ON public.material_requests (destination_client_id);

DROP FUNCTION public.material_request_create(uuid, text, jsonb, text, uuid, uuid, text, timestamptz, text);

CREATE OR REPLACE FUNCTION public.material_request_create(
    p_actor_id uuid,
    p_reason text,
    p_lines jsonb,
    p_priority text DEFAULT 'normal',
    p_plant_id uuid DEFAULT NULL,
    p_maintenance_visit_id uuid DEFAULT NULL,
    p_destination text DEFAULT NULL,
    p_required_at timestamptz DEFAULT NULL,
    p_observations text DEFAULT NULL,
    p_destination_client_id uuid DEFAULT NULL
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

    -- Cliente destino: solo comercial activo. No se usa para autorización.
    IF p_destination_client_id IS NOT NULL
        AND NOT EXISTS (
            SELECT 1
            FROM public.clients AS client
            WHERE client.id = p_destination_client_id
              AND client.active IS TRUE
              AND client.is_commercial IS TRUE
        ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DESTINATION_CLIENT';
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
        destination, required_at, observations, destination_client_id
    ) VALUES (
        public.next_material_request_code(), p_actor_id, p_plant_id,
        p_maintenance_visit_id, p_reason, p_priority, p_destination,
        p_required_at, p_observations, p_destination_client_id
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

REVOKE EXECUTE ON FUNCTION public.material_request_create(uuid, text, jsonb, text, uuid, uuid, text, timestamptz, text, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.material_request_create(uuid, text, jsonb, text, uuid, uuid, text, timestamptz, text, uuid)
TO service_role;

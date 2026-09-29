-- Inventario V1 (base): catálogo, unidades serializadas y libro mayor.
--
-- Un solo almacén (sin warehouses/warehouse_id por decisión de diseño).
-- Sin contadores de stock: los KPIs se derivan de items + movements.
-- updated_at se mantiene desde aplicación (patrón del proyecto: no existe
-- función trigger reutilizable; ver plant_energy_tariffs.repository.js).
-- movements es histórico/inmutable (append-only): sin updated_at y con
-- trigger que bloquea UPDATE/DELETE incluso para service_role. Las
-- correcciones futuras son movimientos compensatorios, nunca edición.
-- Transiciones de estado completas corresponden al service, no a triggers.
-- Semántica del ledger (dirección implícita en el tipo, quantity > 0 siempre):
-- in: entrada normal de inventario. assign: disponible -> asignado.
-- install: asignado -> instalado. sell: salida por venta.
-- return: retorno hacia disponibilidad según transición del service.
-- write_off: salida por baja. adjust_in: ajuste positivo de existencia.
-- adjust_out: ajuste negativo de existencia.
-- Seriales: UNIQUE global case-sensitive; el backend futuro normaliza con
-- trim + uppercase antes de escribir/buscar. Concurrencia: las operaciones
-- quantity que consumen stock deberán ejecutarse atómicamente mediante
-- RPC/transacción PostgreSQL con locking (responsabilidad del backend).

CREATE TABLE public.inventory_products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (length(trim(name)) > 0),
    category text NOT NULL
        CHECK (category IN ('inverter', 'solar_panel', 'smart_meter', 'battery',
            'datalogger', 'protection', 'structure', 'cable', 'other')),
    manufacturer text,
    model text,
    unit text NOT NULL CHECK (length(trim(unit)) > 0),
    tracking_mode text NOT NULL
        CHECK (tracking_mode IN ('serialized', 'quantity')),
    reorder_level numeric NOT NULL DEFAULT 0
        CHECK (reorder_level >= 0),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE RESTRICT,
    serial_number text NOT NULL CHECK (length(trim(serial_number)) > 0),
    status text NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'assigned', 'installed', 'sold', 'written_off')),
    client_id uuid REFERENCES public.clients(id) ON DELETE RESTRICT,
    plant_id uuid REFERENCES public.plants(id) ON DELETE RESTRICT,
    device_id uuid REFERENCES public.devices(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX inventory_items_serial_number_unique
    ON public.inventory_items (serial_number);

CREATE TABLE public.inventory_movements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE RESTRICT,
    item_id uuid REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
    movement_type text NOT NULL
        CHECK (movement_type IN ('in', 'assign', 'install', 'sell', 'return', 'write_off',
            'adjust_in', 'adjust_out')),
    quantity numeric NOT NULL CHECK (quantity > 0),
    from_status text,
    to_status text,
    client_id uuid REFERENCES public.clients(id) ON DELETE RESTRICT,
    plant_id uuid REFERENCES public.plants(id) ON DELETE RESTRICT,
    device_id uuid REFERENCES public.devices(id) ON DELETE RESTRICT,
    notes text,
    created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Integridad estructural mínima (invariantes, sin lógica de negocio ni
-- transiciones: eso corresponde al service).
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
        -- Consistencia cliente/planta contra client_plants cuando ambas existen.
        IF NEW.client_id IS NOT NULL AND NEW.plant_id IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM public.client_plants
                WHERE client_id = NEW.client_id AND plant_id = NEW.plant_id
            ) THEN
            RAISE EXCEPTION 'client_id y plant_id no corresponden a client_plants'
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
        -- Consistencia cliente/planta contra client_plants cuando ambas existen.
        IF NEW.client_id IS NOT NULL AND NEW.plant_id IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM public.client_plants
                WHERE client_id = NEW.client_id AND plant_id = NEW.plant_id
            ) THEN
            RAISE EXCEPTION 'client_id y plant_id no corresponden a client_plants'
                USING ERRCODE = '23503';
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_items_structure_check
BEFORE INSERT OR UPDATE ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_inventory_structure();

CREATE TRIGGER inventory_movements_structure_check
BEFORE INSERT OR UPDATE ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.enforce_inventory_structure();

-- Ledger append-only: bloquea UPDATE y DELETE (incluido service_role).
-- INSERT sigue permitido. Sin bypass administrativos.
CREATE OR REPLACE FUNCTION public.prevent_inventory_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'inventory_movements es append-only: use movimientos compensatorios'
        USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER inventory_movements_no_update_no_delete
BEFORE UPDATE OR DELETE ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_movement_mutation();

-- tracking_mode inmutable tras el primer uso: solo puede cambiar mientras
-- el producto no tenga items ni movements. Otros campos siguen editables.
CREATE OR REPLACE FUNCTION public.prevent_inventory_tracking_mode_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.tracking_mode IS DISTINCT FROM NEW.tracking_mode
        AND (EXISTS (SELECT 1 FROM public.inventory_items WHERE product_id = NEW.id)
            OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE product_id = NEW.id)) THEN
        RAISE EXCEPTION 'tracking_mode no puede cambiar tras el primer uso del producto'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_products_tracking_mode_check
BEFORE UPDATE ON public.inventory_products
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_tracking_mode_change();

CREATE INDEX inventory_products_category_idx
    ON public.inventory_products (category);
CREATE INDEX inventory_products_tracking_mode_idx
    ON public.inventory_products (tracking_mode);
CREATE INDEX inventory_products_active_idx
    ON public.inventory_products (active);
CREATE INDEX inventory_items_product_id_idx
    ON public.inventory_items (product_id);
CREATE INDEX inventory_items_status_idx
    ON public.inventory_items (status);
CREATE INDEX inventory_items_client_id_idx
    ON public.inventory_items (client_id);
CREATE INDEX inventory_items_plant_id_idx
    ON public.inventory_items (plant_id);
CREATE INDEX inventory_items_device_id_idx
    ON public.inventory_items (device_id);
CREATE INDEX inventory_movements_product_created_idx
    ON public.inventory_movements (product_id, created_at DESC);
CREATE INDEX inventory_movements_item_created_idx
    ON public.inventory_movements (item_id, created_at DESC);
CREATE INDEX inventory_movements_client_id_idx
    ON public.inventory_movements (client_id);
CREATE INDEX inventory_movements_plant_id_idx
    ON public.inventory_movements (plant_id);
CREATE INDEX inventory_movements_device_id_idx
    ON public.inventory_movements (device_id);
CREATE INDEX inventory_movements_type_idx
    ON public.inventory_movements (movement_type);

ALTER TABLE public.inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
    public.inventory_products,
    public.inventory_items,
    public.inventory_movements
FROM PUBLIC, anon, authenticated;

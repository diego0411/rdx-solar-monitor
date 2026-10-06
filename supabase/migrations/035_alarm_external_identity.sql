-- 035_alarm_external_identity.sql
-- Unicidad concurrente de episodios con ID externo del fabricante.
--
-- Contexto: 034 solo protege unicidad de episodios ACTIVE mediante
-- índices parciales. HYXi entrega episodios con id estable
-- (external_alarm_id = String(item.id)) que pueden importarse ya
-- resueltos; sin árbitro de unicidad, dos procesos concurrentes pueden
-- duplicar el mismo evento resolved con select-then-insert.
--
-- Cambio mínimo: UN SOLO índice UNIQUE parcial. Sin columnas nuevas,
-- sin constraints nuevos, sin tocar RLS ni los índices de 034 (034
-- congelada, no se edita).
--
-- Compatibilidad:
-- - HYXi (provider='hyxi', external_alarm_id=String(id)) queda protegido
--   contra duplicados en cualquier status.
-- - Growatt usa external_alarm_id NULL: queda FUERA del índice parcial
--   (predicado IS NOT NULL) y PostgreSQL permite múltiples NULL sin
--   conflicto, porque las filas NULL ni siquiera entran al índice.
CREATE UNIQUE INDEX alarms_provider_external_uidx
    ON public.alarms (provider, external_alarm_id)
    WHERE external_alarm_id IS NOT NULL;

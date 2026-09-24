# Modelo económico

El módulo usa exclusivamente energía (`kWh`) persistida en `energy_intervals`. La producción es la energía FV generada; el consumo es la demanda registrada; la importación entra desde la red y la exportación sale hacia ella. El autoconsumo inicial se estima como `producción - exportación`. En instalaciones con batería esta aproximación no describe todos los flujos internos y se muestra como una estimación.

Cada intervalo utiliza la tarifa cuya vigencia contiene su fecha local. El valor de producción (`producción × tarifa de compra`) expresa el valor bruto de la energía generada. El ahorro (`autoconsumo × tarifa de compra`) expresa únicamente el consumo evitado. Una exportación `monetary` se valora con su tarifa de exportación; `energy_credit` conserva primero el crédito en kWh y solo recibe valor monetario cuando la tarifa de exportación está configurada explícitamente; `none` no aporta valor de exportación. El beneficio económico estimado suma ahorro por autoconsumo y valor monetario de exportación.

Los resultados derivados no se guardan en los históricos. Un dato energético, tarifa o valoración ausente permanece `null`, y una exportación superior a la generación marca el intervalo como inconsistente. La cobertura informada es conservadora: disponer de filas no demuestra por sí solo que el periodo esté completo.

## Aplicación de la migración

Aplicar `supabase/migrations/015_plant_energy_tariffs.sql` mediante el flujo habitual de migraciones de Supabase antes de habilitar los endpoints económicos. La migración conserva `plant_financial_profiles` y `plant_electricity_bills`; no copia ni elimina datos existentes.

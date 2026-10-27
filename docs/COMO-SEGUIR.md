# Cómo poner en marcha la copia en la nube

La caja funciona siempre con los datos guardados en el equipo (sin internet también).
La copia en la nube es un respaldo: cada minuto, si hay internet, el equipo sube a
Neon lo que cambió. Nunca baja datos solo.

## Una sola vez, en Vercel

1. En el proyecto **milenio-market** → **Storage** → **Create Database** → **Neon**,
   y conectarla al proyecto. Eso crea la variable `DATABASE_URL` (o `POSTGRES_URL`).
2. Nada más. La primera caja que abre la app publicada recibe una clave generada
   por el servidor y queda emparejada; después nadie más puede pedir una. La clave
   se ve en **Ajustes → Copia en la nube** (anotarla para recuperar en otra compu).
   Opcional: `SYNC_CLAVE` en Vercel fija una clave a mano y desactiva el alta automática.

## En la caja

No hay que hacer nada: se activa sola. Arriba, en la barra, aparece "Nube al día"
o "Nube: revisar" si algo falló.

## Si se rompe la compu

En el equipo nuevo, sin cargar nada: **Ajustes → Copia en la nube** → clave →
**Recuperar desde la nube**. Trae lo del último equipo que subió datos.

## Qué se guarda en Neon

Una tabla `registros(dispositivo, tabla, id, datos jsonb, borrado, actualizado)`:
una fila por producto, venta, turno, movimiento, cliente o ajuste. Lo borrado queda
marcado con `borrado = true`. Los ajustes propios del equipo (la clave, las marcas
de sincronización) no se suben.

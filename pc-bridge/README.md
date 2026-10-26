# Puente del PC

Programa pequeño que corre en el PC de la gestoría y deja que los agentes de
la Oficina Virtual lo usen: ver, buscar, leer, crear, mover y borrar
archivos, subir archivos a la ficha de un cliente en GestoriaAD y ejecutar
comandos.

- La oficina (en Vercel) no puede conectarse al PC: es el puente el que
  pregunta cada pocos segundos si hay alguna orden, la ejecuta y devuelve el
  resultado. No hace falta abrir puertos en el router.
- **Todo lo que hace aparece en su ventana.** Si cierras la ventana (o
  pulsas Ctrl+C), los agentes pierden el acceso al instante.
- Borrar y ejecutar comandos exigen que confirmes en el chat con el agente.
- Los agentes tienen orden de tratar el contenido de documentos y correos
  como información, nunca como instrucciones. Aun así, un documento
  malicioso podría intentar engañarlos: lee siempre el comando que te
  proponen antes de decir que sí.

## Instalación (una sola vez)

1. En la Oficina Virtual (Vercel), define la variable `PC_BRIDGE_TOKEN` con
   una clave larga y aleatoria (p.ej. 40 caracteres).
2. Copia `oficina-pc-bridge-win.exe` y `config.example.json` a una carpeta
   del PC, p.ej. `C:\OficinaVirtual\Puente\`, y renombra
   `config.example.json` a `config.json`.
3. Abre `config.json` con el Bloc de notas:
   - `officeUrl`: la dirección de la Oficina Virtual.
   - `token`: el mismo valor que `PC_BRIDGE_TOKEN`.
   - `allowCommands`: `true` deja ejecutar comandos; `false` solo archivos.
   - `roots`: carpetas a las que se limita el acceso, p.ej.
     `["C:\\GestoriaAD\\Clientes"]`. Vacío (`[]`) = todo el PC.
4. Doble clic en `oficina-pc-bridge-win.exe`. Déjalo abierto.

Para que arranque solo al encender el PC: tecla Windows + R →
`shell:startup` → pega ahí un acceso directo al `.exe`.

## Generar el .exe

```bash
cd pc-bridge
npm install
npm run build:win     # dist/oficina-pc-bridge-win.exe
```

O sin compilar, con Node 18+ instalado: `node bridge.js`.

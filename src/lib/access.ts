// Usuarios de la oficina (HTTP Basic Auth): APP_USERS="nico:clave1,maria:clave2".
export function configuredUsers(): Array<[string, string]> {
  const users: Array<[string, string]> = []
  for (const entry of (process.env.APP_USERS || '').split(',')) {
    const i = entry.indexOf(':')
    if (i > 0) users.push([entry.slice(0, i).trim(), entry.slice(i + 1).trim()])
  }
  return users
}

// Las herramientas que tocan datos reales (GestoriaAD, el PC) solo se dan a
// los agentes cuando la oficina está protegida con contraseña: una oficina
// abierta no puede dejar a cualquiera con la URL borrar clientes o
// ejecutar comandos en el PC.
export function officeProtected(): boolean {
  return configuredUsers().length > 0
}

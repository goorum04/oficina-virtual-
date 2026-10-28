// Horario de la gestoría (hora de Andorra): fuera de él los agentes duermen
// y no hacen nada por su cuenta (ni correo, ni repasos, ni expedientes).
export const WORK_START_HOUR = 8
export const WORK_END_HOUR = 20

export function andorraHour(date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Andorra', hour: '2-digit', hourCycle: 'h23' }).format(date)
  return Number(h)
}

export function isOffHours(date = new Date()): boolean {
  const h = andorraHour(date)
  return h >= WORK_END_HOUR || h < WORK_START_HOUR
}

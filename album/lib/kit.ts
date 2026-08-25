import type { Team } from './types';

export type KitPattern = 'stripes' | 'halves' | 'sash' | 'hoops' | 'plain';

/**
 * El patrón de la camiseta del club, dibujado con sus dos colores.
 *
 * No es el escudo ni la equipación de nadie: son franjas y bandas generadas
 * por nosotros a partir de dos colores. Sirve para lo que importa en un álbum:
 * que la hoja del Athletic no se parezca a la del Betis aunque en ninguna de
 * las dos haya todavía una sola foto.
 */
export function kitBackground(
  pattern: string | null | undefined,
  primary: string,
  secondary: string,
): string {
  const a = primary || '#7c8291';
  const b = secondary || '#ffffff';

  switch ((pattern || 'plain') as KitPattern) {
    case 'stripes':
      return `repeating-linear-gradient(90deg, ${a} 0 14%, ${b} 14% 28%)`;
    case 'hoops':
      return `repeating-linear-gradient(180deg, ${a} 0 12%, ${b} 12% 24%)`;
    case 'halves':
      return `linear-gradient(90deg, ${a} 0 50%, ${b} 50% 100%)`;
    case 'sash':
      return `linear-gradient(118deg, ${b} 0 34%, ${a} 34% 58%, ${b} 58% 100%)`;
    default:
      return `linear-gradient(158deg, ${a} 0%, ${b} 190%)`;
  }
}

export const teamKit = (team?: Pick<Team, 'pattern' | 'primary_color' | 'secondary_color'> | null): string =>
  kitBackground(team?.pattern, team?.primary_color ?? '#7c8291', team?.secondary_color ?? '#ffffff');

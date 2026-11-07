import { effectiveAddress, formatAddress, normalizeStreet } from '../domain/address';
import type { Stop } from '../domain/types';
import { haversineMeters } from '../services/routing/haversine';

export interface AuditAlert {
  kind: 'mesma-rua' | 'antes-de-atravessar' | 'proximas';
  title: string;
  message: string;
  stopIds: string[];
}

const hasPending = (s: Stop) => s.packages.some((p) => p.status === 'pending');

/**
 * Auditoria ao sair de uma parada rumo à próxima.
 * Considera TODOS os pacotes pendentes, de qualquer grupo. Nunca altera status.
 */
export function auditLeaving(current: Stop, next: Stop | undefined, all: Stop[], dividerName?: string): AuditAlert[] {
  const alerts: AuditAlert[] = [];
  const street = normalizeStreet(effectiveAddress(current).street);
  const nextStreet = next ? normalizeStreet(effectiveAddress(next).street) : null;

  // 1) Saindo da rua com pacote pendente nela (inclui a própria parada, se foi pulada)
  if (nextStreet !== street) {
    const same = all.filter((s) => hasPending(s) && normalizeStreet(effectiveAddress(s).street) === street && s.id !== next?.id);
    if (same.length) {
      alerts.push({
        kind: 'mesma-rua',
        title: `Ainda há pacote pendente na ${effectiveAddress(current).street}`,
        message: same.map((s) => `${labels(s)} — ${formatAddress(effectiveAddress(s), false)}`).join('\n'),
        stopIds: same.map((s) => s.id),
      });
    }
  }

  // 2) Vai atravessar a avenida divisora com pendências deste lado
  if (next && current.dividerSide && next.dividerSide && current.dividerSide !== next.dividerSide) {
    const sameSide = all.filter((s) => hasPending(s) && s.dividerSide === current.dividerSide && s.id !== next.id && !alerts[0]?.stopIds.includes(s.id));
    if (sameSide.length) {
      alerts.push({
        kind: 'antes-de-atravessar',
        title: `Antes de atravessar${dividerName ? ' a ' + dividerName : ' a avenida'}`,
        message: `${sameSide.length} parada(s) pendente(s) deste lado:\n` + sameSide.slice(0, 8).map((s) => `${labels(s)} — ${formatAddress(effectiveAddress(s), false)}`).join('\n'),
        stopIds: sameSide.map((s) => s.id),
      });
    }
  }

  // 3) A próxima está longe e há entregas pendentes bem perto daqui
  if (next && current.geo && next.geo) {
    const toNext = haversineMeters(current.geo, next.geo);
    if (toNext > 700) {
      const near = all.filter(
        (s) => hasPending(s) && s.id !== next.id && s.geo && haversineMeters(current.geo!, s.geo) < 300 &&
          !alerts.some((a) => a.stopIds.includes(s.id)),
      );
      if (near.length) {
        alerts.push({
          kind: 'proximas',
          title: 'Entregas pendentes aqui perto',
          message: `A próxima parada fica a ${(toNext / 1000).toFixed(1)} km. Pendentes a menos de 300 m:\n` + near.map((s) => `${labels(s)} — ${formatAddress(effectiveAddress(s), false)}`).join('\n'),
          stopIds: near.map((s) => s.id),
        });
      }
    }
  }
  return alerts;
}

function labels(s: Stop): string {
  const pend = s.packages.filter((p) => p.status === 'pending');
  const nums = pend.filter((p) => !p.extra).map((p) => p.label);
  const extras = pend.filter((p) => p.extra).length;
  return [...nums, ...(extras ? [`+${extras}`] : [])].join(' ');
}

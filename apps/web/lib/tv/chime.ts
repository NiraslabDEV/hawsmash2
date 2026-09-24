/**
 * O toque da TV quando uma senha fica pronta: "ding-dong" de duas notas,
 * gerado no momento (sem ficheiro para carregar nem falhar offline).
 *
 * Mais suave do que o alarme do POS (`lib/pos/chime.ts`): o do POS tem de
 * atravessar o barulho da cozinha; este toca na sala, para quem está à espera.
 *
 * O browser só toca som depois de um toque no ecrã, ou arrancado com
 * `--autoplay-policy=no-user-gesture-required` (docs/TVS.md).
 */

let contexto: AudioContext | null = null;

function obterContexto(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Construtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Construtor) return null;
  contexto ??= new Construtor();
  return contexto;
}

/** `true` quando o browser não deixa tocar (ninguém tocou e sem a opção do quiosque). */
export function somDaTvBloqueado(): boolean {
  const c = obterContexto();
  return !!c && c.state !== 'running';
}

export function prepararSomDaTv(): void {
  const c = obterContexto();
  if (c && c.state === 'suspended') void c.resume();
}

export function tocarSenha(): void {
  const c = obterContexto();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();

  const inicio = c.currentTime + 0.02;
  [
    { f: 1046.5, t: 0 },
    { f: 784, t: 0.42 },
  ].forEach(({ f, t }) => {
    const quando = inicio + t;
    const oscilador = c.createOscillator();
    const volume = c.createGain();
    oscilador.type = 'sine';
    oscilador.frequency.value = f;
    volume.gain.setValueAtTime(0.0001, quando);
    volume.gain.exponentialRampToValueAtTime(0.8, quando + 0.03);
    volume.gain.exponentialRampToValueAtTime(0.0001, quando + 0.9);
    oscilador.connect(volume).connect(c.destination);
    oscilador.start(quando);
    oscilador.stop(quando + 0.95);
  });
}

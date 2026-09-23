/**
 * O toque de "chegou um pedido". Gerado no momento, sem ficheiro de áudio:
 * não há nada para carregar, nada para falhar offline, e soa igual em todas
 * as lojas.
 *
 * Três notas a subir, em onda quadrada — atravessa o barulho de uma cozinha
 * melhor do que um "ding" suave. O volume final é o do PC: o POS tem de ficar
 * com o som do Windows alto e sem estar em silêncio.
 *
 * O browser só deixa tocar som depois de um toque no ecrã. `prepararSom` corre
 * a cada toque e desbloqueia o áudio; no quiosque, o Edge arranca com
 * `--autoplay-policy=no-user-gesture-required` e toca mesmo antes disso.
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

export function prepararSom(): void {
  const c = obterContexto();
  if (c && c.state === 'suspended') void c.resume();
}

export function tocarAlarme(): void {
  const c = obterContexto();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();

  const inicio = c.currentTime + 0.02;
  const notas = [880, 1175, 1568];
  // Duas vezes seguidas: um toque só perde-se no meio de uma venda.
  for (const repeticao of [0, 1]) {
    notas.forEach((frequencia, i) => {
      const t = inicio + repeticao * 0.95 + i * 0.26;
      const oscilador = c.createOscillator();
      const volume = c.createGain();
      oscilador.type = 'square';
      oscilador.frequency.value = frequencia;
      volume.gain.setValueAtTime(0.0001, t);
      volume.gain.exponentialRampToValueAtTime(0.9, t + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      oscilador.connect(volume).connect(c.destination);
      oscilador.start(t);
      oscilador.stop(t + 0.24);
    });
  }
}

export function accountEmail(code: string, brandName: string) {
  return {
    subject: `${code} — o teu código ${brandName}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:32px 24px">
        <p style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#847e72;margin:0">${brandName}</p>
        <h1 style="font-size:22px;margin:16px 0 8px;color:#1a1208">O teu código de entrada</h1>
        <p style="font-size:15px;line-height:1.5;color:#5f5a52;margin:0 0 24px">
          Escreve este código no telemóvel onde estás a entrar. Vale 10 minutos.
        </p>
        <p style="font-size:38px;letter-spacing:.28em;font-weight:700;color:#1a1208;margin:0">${code}</p>
        <p style="font-size:13px;line-height:1.5;color:#847e72;margin:28px 0 0">
          Não pediste isto? Ignora este email — sem o código ninguém entra na tua conta.
        </p>
      </div>
    `,
  };
}

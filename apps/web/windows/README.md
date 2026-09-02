# POS no Windows

1. Abre o endereço HTTPS do POS no Edge e escolhe **Aplicações → Instalar** (o nome da aplicação é o
   da marca da instalação, definido na aba **Aparência**).
2. Vincula o dispositivo à loja certa e confirma que o cardápio aparece.
3. Numa consola PowerShell do utilizador do balcão, executa:

   ```powershell
   .\install-pos-kiosk.ps1 -PosUrl 'https://<o-dominio-desta-instalacao>/pos'
   ```

`-PosUrl` é obrigatório de propósito: o endereço é da instalação, não do produto. Um valor por
omissão aqui é um PC de balcão que arranca a apontar para a loja de outro cliente sem ninguém
reparar.

O instalador cria uma tarefa no início de sessão do utilizador actual. O Edge abre em ecrã inteiro e
reinicia se encerrar. Na loja, troca o URL de staging pelo URL live apenas depois do ensaio.

Para remover o arranque automático, executa `uninstall-pos-kiosk.ps1`. A instalação da PWA no Edge
pode depois ser removida em `edge://apps`.

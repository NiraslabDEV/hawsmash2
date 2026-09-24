# Instruções para o Claude do POS de Maputo — 23 Set 2026

> Estás no PC do balcão da loja **HAWSMASH Maputo**. Este PC corre o **POS** (Edge em quiosque) e a
> **bridge de impressão** (a peça que tira os pedidos da fila e os imprime na **POS80**).
> Ambos estão ligados ao **staging**: `https://hawsmash2-staging.up.railway.app`.
>
> O teu trabalho hoje: **pôr a bridge nova a correr**, **actualizar o arranque do quiosque** e
> **fazer o ensaio com o Gabriel**. No fim, escreves um relatório (secção 7).
>
> O código está no GitHub, `NiraslabDEV/hawsmash2`, ramo **`dev`**. Precisas **pelo menos** do commit
> **`beae3e7`** ("um so papel para todos os pedidos").

---

## O que mudou hoje (para perceberes o que vais ver)

1. **O papel.** Qualquer pedido — balcão, levantamento ou entrega — passa a imprimir **dois talões
   completos**, iguais ao do HAWSMASH 1.0: `*** VIA DE CONTROLO ***` (fica na loja) e
   `*** VIA DO CLIENTE ***` (vai para a cozinha e depois cola-se no saco). Reimprimir sai **um** talão
   marcado `*** REIMPRESSÃO ***`. A base de dados já manda isto. **Mas só a bridge nova sabe desenhar o
   talão completo** — a que está agora neste PC imprime duas comandas curtas no lugar dele.
2. **O POS** (já publicado no staging — basta recarregar): quando entra um pedido online, **toca alto**
   e o botão **Pedidos** fica **vermelho a piscar** com o número de pedidos à espera. Há um botão
   **Esgotados**. Tocar num pedido mostra o **comprovativo** e o botão de aprovar.
3. **O quiosque** passa a arrancar o Edge com `--autoplay-policy=no-user-gesture-required`, para o som
   tocar mesmo antes de alguém tocar no ecrã.

---

## 0. Regras — lê antes de tocar em alguma coisa

- **Não mudes o `.env` da bridge.** Nunca alteres `STORE_ID` nem `SUPABASE_URL`. Nunca mostres, copies
  nem escrevas em lado nenhum o valor de `SUPABASE_SERVICE_ROLE_KEY` ou de `LOCAL_TOKEN`.
- **Não corras testes da base de dados** (`packages/db`) neste PC. O staging tem **esta impressora**
  ligada: cada venda de teste sai em papel e abre a gaveta. Se um teste te disser que há uma bridge viva,
  **não** o contornes com `ALLOW_LIVE_BRIDGE`.
- **Não apagues pedidos, não corras SQL, não faças commit nem push.**
- **Não faças nada com clientes na loja.** Hoje é quarta-feira e a loja está fechada.
- **Se um passo falhar, pára e escreve no relatório** a mensagem exacta. Não improvises uma alternativa.
- Guarda sempre um backup antes de substituir um ficheiro.

---

## 1. Descobrir como a bridge corre neste PC

Numa PowerShell **como Administrador**:

```powershell
Get-ScheduledTask -TaskName "HAWSMASH Print Bridge" -ErrorAction SilentlyContinue |
  Select-Object TaskName, State
(Get-ScheduledTask -TaskName "HAWSMASH Print Bridge" -ErrorAction SilentlyContinue).Actions |
  Select-Object Execute, WorkingDirectory
```

- **Se a tarefa existe:** anota o `Execute` (o caminho do `.exe`) e a `WorkingDirectory`. Nessa pasta
  têm de estar o `.env` e, normalmente, o `brand-logo.b64`. Segue para o passo 2 (caminho A ou B).
- **Se a tarefa não existe**, procura o processo:

  ```powershell
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -match 'print-bridge|hawsmash-print-bridge|src\\index\.ts' } |
    Select-Object ProcessId, Name, ExecutablePath, CommandLine
  ```

  Se correr com `tsx` / `pnpm dev` a partir de uma cópia do repositório, anota a pasta: nesse caso usas o
  **caminho C** do passo 2.
- Se não encontrares bridge nenhuma, **pára** e escreve isso no relatório.

Confirma **só estas duas linhas** do `.env` (não imprimas o ficheiro inteiro):

```powershell
Select-String -Path "<pasta-da-bridge>\.env" -Pattern '^(STORE_ID|SUPABASE_URL)='
```

Esperado: `STORE_ID=00000000-0000-4000-8000-000000000101` e `SUPABASE_URL=https://pqjoanrsjkddkjsllqov.supabase.co`.
Se for diferente, **pára** e reporta.

---

## 2. Obter a bridge nova

**A — há uma cópia do repositório neste PC, com Node 22+ e pnpm:**

```powershell
cd "<pasta-do-repositorio>"
git status                   # tem de estar limpo; se não estiver, pára e reporta
git fetch origin
git checkout dev
git pull origin dev
git log --oneline -1         # tem de ser beae3e7 ou mais recente
pnpm install
pnpm --filter print-bridge build:sea
```

O `.exe` novo fica em `services\print-bridge\build\hawsmash-print-bridge.exe`. Confirma que é o novo:

```powershell
Select-String -Path services\print-bridge\build\bridge.cjs -Pattern 'VIA DE CONTROLO','REIMPRESS','talao_completo' |
  Select-Object -ExpandProperty Pattern -Unique
```

Têm de aparecer os três. Se faltar algum, **pára**.

**B — não há repositório nem Node:** pede ao Gabriel o ficheiro `hawsmash-print-bridge.exe` (ele tem-no
gerado no PC dele, de 23 Set) por pen ou pasta partilhada. **Não descarregues um `.exe` de outro sítio.**

**C — a bridge corre a partir do repositório (`tsx` / `pnpm dev`):** faz o `git pull` do caminho A e
reinicia esse processo. Não precisas de `.exe` nenhum.

---

## 3. Trocar a bridge (caminhos A e B)

```powershell
$pasta = "<WorkingDirectory do passo 1>"
Stop-ScheduledTask -TaskName "HAWSMASH Print Bridge"
Start-Sleep -Seconds 3
Get-Process | Where-Object { $_.Path -like "$pasta*" }      # não pode aparecer nada

Rename-Item "$pasta\hawsmash-print-bridge.exe" "hawsmash-print-bridge.exe.bak-2026-09-23"
Copy-Item "<caminho do .exe novo>" "$pasta\hawsmash-print-bridge.exe"

Start-ScheduledTask -TaskName "HAWSMASH Print Bridge"
Start-Sleep -Seconds 5
Get-ScheduledTask -TaskName "HAWSMASH Print Bridge" | Select-Object State   # Running
```

**Não** toques no `.env` nem no `brand-logo.b64` dessa pasta.

Para voltar atrás, se algo correr mal: pára a tarefa, apaga o `.exe` novo, dá ao `.bak-2026-09-23` o
nome `hawsmash-print-bridge.exe` e arranca a tarefa outra vez.

---

## 4. Confirmar que a bridge está viva

Espera 60 segundos. No painel `https://hawsmash2-staging.up.railway.app/sistema` (o Gabriel entra), a
bridge de Maputo tem de aparecer **verde**. Se passados 2 minutos continuar vermelha, **pára** e reporta.

---

## 5. Quiosque: o som tem de tocar logo ao arrancar

Vê se a tarefa do quiosque já tem a opção:

```powershell
(Get-ScheduledTask -TaskName "POS Kiosk" -ErrorAction SilentlyContinue).Actions.Arguments
```

- **Se já tiver `--autoplay-policy=no-user-gesture-required`:** não faças nada.
- **Com o repositório (caminho A):**

  ```powershell
  powershell -ExecutionPolicy Bypass -File apps\web\windows\install-pos-kiosk.ps1 `
    -PosUrl "https://hawsmash2-staging.up.railway.app/pos"
  ```

- **Sem o repositório:** acrescenta a opção à tarefa que lá está:

  ```powershell
  $t = Get-ScheduledTask -TaskName "POS Kiosk"
  $a = $t.Actions[0]
  $a.Arguments = $a.Arguments + " --autoplay-policy=no-user-gesture-required"
  Set-ScheduledTask -TaskName "POS Kiosk" -Action $a
  ```

- **Se não existir tarefa "POS Kiosk"**, não inventes uma: escreve no relatório como o POS arranca.

Depois fecha **todos** os processos do Edge e arranca a tarefa, para o POS abrir já com a versão nova e com
a opção do som. Fechar a janela não chega: com o "arranque rápido" o Edge fica em segundo plano e ignora a
opção (aconteceu a 24 Set). O instalador já faz isto; à mão:

```powershell
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force
Start-ScheduledTask -TaskName "POS Kiosk"
```

**Som do PC** — se nem o YouTube tem som, o problema não é o POS:
- há colunas ligadas? Muitos PCs tácteis e monitores **não têm**, e o som vai para o HDMI do monitor;
- `Win+R` → `mmsys.cpl` → **Reprodução**: as colunas como **Predefinidas** (a barra verde mexe com som);
- volume do Windows alto, e o Edge não silenciado no **Misturador de volume**;
- `Get-CimInstance Win32_SoundDevice | Select-Object Name, Status` e
  `Get-Service Audiosrv, AudioEndpointBuilder` (têm de estar `Running`).

No POS, o aviso **"🔇 Som dos pedidos desligado — tocar para ligar"** no topo quer dizer que o Edge abriu
sem a opção do som: um toque liga-o e dá um toque de teste. Se tocar no aviso e continuar sem som, é o PC.

---

## 6. Ensaio, com o Gabriel ao lado

Faz os testes por esta ordem. Em cada um, anota **o que saiu em papel**.

**a) Venda de balcão em dinheiro.** Entra no POS com o cartão e o PIN. Vende 1 artigo simples (por
exemplo, Pastéis de Nata) em dinheiro, e recebe mais do que o total para haver troco.
Tem de sair: **dois talões** — `*** VIA DE CONTROLO ***` e `*** VIA DO CLIENTE ***` — com `** BALCÃO **`,
`Recebido`, `Troco` e `[ PAGO VIA DINHEIRO ]`, e **a gaveta tem de abrir**.

**b) Pedido online.** Num telemóvel, abre `https://hawsmash2-staging.up.railway.app/l/maputo` — **tem de
ser `/l/maputo`**: a Matola não tem bridge e nada dela sai nesta impressora. Faz um pedido de
levantamento, paga por M-Pesa (manual) e anexa um comprovativo qualquer.
No POS tem de: **tocar alto**, e o botão **Pedidos** ficar vermelho a piscar com o número 1. Abre
**Pedidos**; o pedido está na primeira coluna, **INTERNET**, com `📎 VER COMPROVATIVO` e os botões
**Aprovar** / **Recusar** no próprio cartão. Toca no cartão para ver o comprovativo e toca em **Aprovar**
(o mesmo pedido aparece também na aba **Delivery** do POS, com os mesmos botões). O cartão passa para
**A FAZER**. Tem de sair: **dois talões** com `** LEVANTAMENTO **` e `[ PAGO VIA M-PESA ]`.

**c) Reimpressão.** No painel `/pedidos`, nesse pedido, toca em **"2.ª via cliente"**. Tem de sair **um**
talão com `*** REIMPRESSÃO ***`.

**d) Esgotados.** No POS, toca em **Esgotados**, marca um artigo como esgotado e volta a vender: o artigo
tem de estar a cinzento. **Volta a pô-lo à venda antes de acabar.**

Se uma aprovação falhar com **"Falta … na loja"**, é verdade: falta matéria-prima na ficha técnica. Não é
um bug. Diz ao Gabriel, que repõe no painel **Estoque**. Não contornes.

---

## 7. Relatório

Escreve `RELATORIO-POS-MAPUTO-2026-09-23.md` **ao lado deste ficheiro** (ou no Ambiente de Trabalho, se não
houver repositório) com:

- como a bridge corria (tarefa ou processo), o caminho do `.exe` e o caminho usado (A, B ou C);
- o commit que ficou (`git log --oneline -1`), se houver repositório;
- os argumentos da tarefa "POS Kiosk", antes e depois;
- em cada ensaio (6a–6d): o que saiu em papel, os rótulos que apareceram, se tocou e se piscou;
- tudo o que falhou, com a mensagem exacta;
- **nunca** chaves, tokens nem o conteúdo do `.env`.

---

## O que é normal e não é para corrigir

- **Uma venda feita sem internet** imprime na hora um talão e uma comanda **no formato antigo** — é o POS
  que os gera sozinho, sem servidor. Quando a rede volta, não sai papel repetido.
- **Pedidos da Matola nunca saem aqui.** A bridge de Maputo ignora-os de propósito.
- **Um pedido que já estava na fila quando o POS arrancou não toca** — só os que chegam depois.
  Mas o botão Pedidos pisca enquanto houver pedidos por aprovar.

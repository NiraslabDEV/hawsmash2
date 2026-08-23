# HARDWARE.md — equipamento, ligações e contingência (por loja)

> O equipamento é **a cargo do HAWSMASH**; a especificação, instalação e configuração são da Niraslab
> (proposta §9). Este documento é o que se manda ao cliente **antes da compra** e o que se segue na instalação.
> **O kit é idêntico nas duas lojas em tudo excepto no PC do balcão** (§1.1) — a equipa de uma tem de
> conseguir socorrer a outra. A diferença de PC está **confinada de propósito**: impressão, rede, gaveta e
> consumíveis são iguais nas duas unidades, para que o caminho que faz sair papel se depure ao telefone
> uma vez só.

---

## 1. Lista por loja

| # | Equipamento | Especificação mínima | Porquê |
|---|---|---|---|
| 1 | **PC touch (balcão)** | **Diferente por loja — ver §1.1.** Mínimos: Windows 10/11 **64-bit**, CPU Intel **8.ª geração ou superior**, 8 GB RAM, SSD 128 GB, ecrã touch ≥ 15", **Ethernet** (ou adaptador USB-Ethernet) | Corre o POS (browser) **e** o print-bridge. Ethernet porque Wi-Fi cai primeiro |
| 2 | **Impressora térmica — cozinha** | 80 mm, ESC/POS, **Ethernet (RJ45)**, corte automático. Ref.: **Xprinter XP-T80Q** (já validada no HAWSMASH 1.0) | Comanda da cozinha. Rede em vez de USB → não depende do PC estar aberto |
| 3 | **Impressora térmica — balcão** | igual à #2 | Talão do cliente **e** comando da gaveta |
| 4 | **Gaveta de dinheiro** | metálica, **RJ11/RJ12**, 12 V ou 24 V — **tem de coincidir com a impressora #3**. O cabo tem de ser **6P6C (6 pinos)** — um cabo de telefone 6P4C encaixa na perfeição e **nunca** abre a gaveta (§4, teste 1) | Abre pelo pulso ESC/POS da impressora do balcão |
| 5 | **Switch de rede** | 5 portas, gigabit | Liga PC + 2 impressoras + router |
| 6 | **Router principal** | do ISP, com porta LAN livre | Internet da loja |
| 7 | **Router/modem 4G de reserva** | com **failover automático** (ou router dual-WAN) + SIM com dados | Compromisso da proposta §9: o balcão não pode parar |
| 8 | **UPS (nobreak)** | ≥ 650 VA, ligado a PC + impressora do balcão + switch + router | **Falha de energia é o risco mais comum em Maputo.** Sem UPS, corte de luz = venda perdida e caixa por fechar |
| 9 | **TV** (opcional na abertura) | qualquer TV com HDMI + **box Android** (ou mini-PC) com browser em modo kiosk | Menu board e ecrã de senhas |
| 10 | **Consumíveis** | rolos de papel térmico 80 mm × 80 mm — **stock para 1 mês por loja** | Ficar sem papel a meio de um sábado |
| 11 | **Visor do cliente** (se o PC touch já o trouxer) | mostrador de **2 linhas × 20 caracteres**, ligado por porta série/USB-série, protocolo **CD5220** ou **Epson DM-D (ESC/POS)** | Total, número do M-Pesa e troco virados para quem paga. Ver §1.2 |

> **Cartão:** o terminal (POS bancário) é do banco e continua separado. O sistema apenas **regista** que o
> pagamento foi em cartão — não comunica com o terminal. Confirmar com o cliente antes da abertura.

### 1.2 Visor do cliente

O PC touch do HAWSMASH traz um mostrador de duas linhas montado por trás do ecrã. É o print-bridge que
escreve nele — nunca o browser — pela mesma razão da impressora: é o bridge que continua a correr quando o
POS está fechado, bloqueado ou adormecido, e é ele que mantém o nome da casa a andar quando não há venda.

**O que aparece, passo a passo:**

| Momento no POS | Linha de cima | Linha de baixo |
|---|---|---|
| Sem venda | `HAWSMASH` a atravessar o visor | `BEM-VINDO` |
| Artigo tocado (2,5 s) | nome do artigo | `2 x` · total da linha |
| Carrinho | `3 artigos` | `TOTAL` · valor |
| Pagamento M-Pesa/e-Mola | `M-PESA` · **número da loja** | `A PAGAR` · valor |
| Dinheiro com troco calculado | `RECEBIDO` · valor | `TROCO` · valor |
| Venda concluída | `OBRIGADO!` | `SENHA` · número do dia |

**Instalação (por loja):**

1. Ligar o visor e ver a porta em **Gestor de Dispositivos → Portas (COM e LPT)** (`COM1`, `COM3`…).
2. No `.env` do bridge: `CUSTOMER_DISPLAY_PORT=COM3` (e `CUSTOMER_DISPLAY_BAUD` se não for 9600 — vem no
   manual do visor; 9600 é o mais comum).
3. Reiniciar o bridge. Se o `HAWSMASH` começar a andar, está feito.
4. Se saírem caracteres estranhos ou nada, trocar `CUSTOMER_DISPLAY_PROTOCOL=cd5220` por `escpos` e repetir.
   São os dois protocolos que 95% destes visores falam; se nenhum funcionar, é preciso o modelo do
   mostrador (**B-018**).

**Sem visor configurado o bridge corre exactamente como antes** — a linha fica vazia no `.env` e nada muda.

### 1.1 PC do balcão — configuração real por loja

As duas lojas **não levam o mesmo PC**. Está documentado aqui porque é a única diferença de hardware entre
unidades, e porque muda o plano de substituição de cada uma.

| | **Maputo** | **Matola** |
|---|---|---|
| Equipamento | a adquirir | **WINTEC AnyPOS100** (variante `1461A`) |
| CPU | Intel 8.ª geração ou superior | Intel Core i5-7200U (2 núcleos / 4 threads, 2.5–3.1 GHz) |
| RAM | 8 GB | 8 GB ✅ |
| SO | Windows 11 | Windows 10 Pro 22H2 · 64-bit |
| Ecrã | ≥ 15", 1920×1080 preferencial | 1366×768 |
| Impressora integrada | conforme o modelo | sim — fila Windows `POS80`, porta `VPORT-USB:` |
| Portas COM | conforme o modelo | **COM1–COM6** (chip série interno). O `Win32_SerialPort` não as enumera — usar `mode` ou `Get-PnpDevice -Class Ports` |
| Actualizações de segurança | sim | **não — fim de suporte a 14/10/2025** |
| Substituição prevista | ~2031 | **2027 — é a primeira a trocar** |

**Porque é a Matola que fica com esta máquina:** Maputo herda todo o histórico do HAWSMASH 1.0 na migração
(`store_id = maputo`, CLAUDE §15) e abre com o volume que já existe. Matola abre do zero.

**Regra de compra para qualquer PC de balcão novo.** A geração do processador é o que separa uma máquina que
recebe actualizações de uma que não recebe — e é verificável no acto da compra:

> O número a seguir a `i3-` / `i5-` / `i7-` tem de **começar por 8 ou mais alto**.
> `i5-8250U` ✅ · `i5-1135G7` ✅ · `i5-7200U` ❌ · `i5-6300U` ❌

**A impressora integrada da Matola não é usada na abertura.** Não está na LAN, e o print-bridge só fala TCP
([`printer-client.ts`](../services/print-bridge/src/printer-client.ts)). As duas lojas imprimem pelas térmicas
Ethernet (#2 e #3) precisamente para o caminho da impressão ser **byte a byte o mesmo** nas duas. A `POS80`
fica como reserva: sendo uma fila Windows, alcança-se por RAW ao spooler se algum dia compensar.

**Regra de UI que daqui resulta:** o POS desenha-se e valida-se a **1366×768**. O que passa em Matola passa em
Maputo com folga; o contrário não é verdade. Uma só interface — nada de layout condicional por loja.

**Risco assumido (Matola):** Windows 10 sem actualizações de segurança e sem caminho para o Windows 11 (o
i5-7200U é de 7.ª geração, abaixo do requisito de CPU). Mitigações obrigatórias em §3; risco registado em
[`RUNBOOK.md §8`](RUNBOOK.md).

---

## 2. Ligações

```
                    ┌──────────────┐
   Internet ────────│ Router ISP   │
                    └──────┬───────┘
   4G de reserva ─────────┤ (failover automático)
                          │
                    ┌─────┴──────┐
                    │   SWITCH   │
                    └──┬───┬───┬─┘
                       │   │   │
       PC TOUCH ───────┘   │   └─────── IMPRESSORA COZINHA (192.168.1.50:9100)
       (POS + bridge)      │
                           └─────────── IMPRESSORA BALCÃO  (192.168.1.51:9100)
                                                 │ RJ11
                                          ┌──────┴───────┐
                                          │    GAVETA    │
                                          └──────────────┘
```

- **A gaveta liga-se à impressora do balcão, nunca ao PC.** Abre por pulso ESC/POS
  (`1B 70 00 19 FA`) enviado pelo print-bridge.
- **IPs fixos** (reserva por MAC no router, ou IP estático na impressora):

| Dispositivo | IP sugerido | Porta |
|---|---|---|
| PC touch / print-bridge | `192.168.1.20` | `7777` (HTTP local do bridge) |
| Impressora cozinha | `192.168.1.50` | `9100` |
| Impressora balcão | `192.168.1.51` | `9100` |
| Box da TV | `192.168.1.60` | — |

- **Tudo em cabo.** Wi-Fi só para os dispositivos que não vendem.

---

## 3. Configuração do PC do balcão

- [ ] Windows: **suspensão desligada**, ecrã sempre ligado, **login automático**, actualizações fora do horário de loja
- [ ] Conta de utilizador só para o balcão (sem instalar nada, sem navegar)
- [ ] Chrome/Edge com o **POS instalado como PWA** e a arrancar em **modo kiosk** com o Windows
- [ ] `print-bridge` instalado como serviço/tarefa agendada, **arranque automático + reinício em falha**
- [ ] `.env` do bridge preenchido: `STORE_ID`, IPs das duas impressoras, `LOCAL_TOKEN`, service key **restrita**
- [ ] Teste de impressão nas duas impressoras + teste de gaveta a partir do POS
- [ ] Antivírus/firewall a permitir a porta `7777` na LAN
- [ ] Etiqueta física no PC com: loja, IPs, contacto de suporte
- [ ] **Cópia cifrada do `.env` e do `.exe` do bridge guardada fora da máquina** (o `.env` tem a service key) — §5.1

**Só na Matola** — mitigações do Windows 10 sem suporte (§1.1). Não são opcionais:

- [ ] Conta do balcão **sem privilégios de administrador**
- [ ] Navegação bloqueada: o Chrome arranca em kiosk na URL do POS e mais nada
- [ ] Sem portas de entrada abertas no router para esta máquina
- [ ] Windows Defender activo (as definições continuam a actualizar mesmo sem patches do SO)
- [ ] AnyDesk: palavra-passe forte de acesso não assistido, lista de permissões, e **quem tem acesso registado** no `RUNBOOK.md`
- [ ] Nada mais instalado: sem email, sem downloads, sem pens USB

---

## 4. Testes de aceitação (fazer com o equipamento na mão, antes de ir para a loja)

> Este é o guião para o PC touch + gaveta + impressora que o cliente envia para testes.

| # | Teste | Passa quando |
|---|---|---|
| 1 | Venda em dinheiro com troco | Talão sai, gaveta abre, troco correcto no ecrã e no papel |
| 2 | Venda em M-Pesa | Talão sai, gaveta **não** abre |
| 3 | Comanda de cozinha | Sai na impressora da cozinha, com o número do dia grande e **sem preços** |
| 4 | **Internet desligada** (tirar o cabo do router) | Venda entra na fila, **talão sai na mesma**, gaveta abre, banner "SEM LIGAÇÃO" |
| 5 | Internet reposta | Fila sincroniza sozinha; **nenhum pedido duplicado** no painel |
| 6 | Impressora desligada durante a venda | Venda grava na mesma; job fica em fila; ao ligar, imprime; alerta disparado |
| 7 | Reinício do PC a meio do expediente | Tudo arranca sozinho (kiosk + bridge) em menos de 2 min, sem intervenção |
| 8 | Falha de energia com UPS | PC, impressora do balcão e router sobrevivem ≥ 10 min |
| 9 | Anulação de venda | Exige perfil/PIN, repõe stock, fica no histórico com motivo |
| 10 | Abrir gaveta fora de venda | Exige perfil e aparece em `event_log` com quem abriu |

Registar o resultado de cada teste (data, quem testou) em `docs/RUNBOOK.md` antes da abertura.

---

## 5. Contingência (o que a equipa faz quando falha)

| Falha | Acção imediata da equipa |
|---|---|
| **Internet em baixo** | Continuar a vender no POS normalmente (offline). Não desligar o PC |
| **Impressora sem papel** | Trocar o rolo; os talões em fila saem sozinhos a seguir |
| **Impressora avariada** | Vender na mesma; a cozinha lê os pedidos no ecrã do POS/painel |
| **Gaveta não abre** | Abrir com a chave física (fica com o responsável), registar as vendas na mesma |
| **PC não arranca** | Vender em papel (talonário de reserva) e registar depois; ligar ao suporte |
| **Falha de energia sem UPS** | Talonário de papel; ao voltar, lançar as vendas no POS pelo talonário |

Cada loja tem, em papel, **uma folha A4 plastificada** com esta tabela e o contacto de suporte.


---

## 5.1 PC de substituição — o que substitui o "kit idêntico"

Com PCs diferentes nas duas lojas, deixa de ser possível levar o de Maputo para a Matola. Em troca há uma
coisa melhor: **o POS é uma aplicação web, portanto qualquer PC com Windows 64-bit e Chrome vira POS em
minutos.** Para isso ser verdade no dia mau — e não uma boa intenção:

1. **`.env` do bridge e `.exe` de cada loja guardados fora da máquina, cifrados.** O `.env` tem a service key
   do Supabase; nunca em claro numa drive partilhada.
2. **Procedimento cronometrado uma vez antes da abertura.** Meta: do PC nu ao primeiro talão impresso em
   **menos de 30 minutos**.
3. **`BRIDGE_DEVICE_ID` novo e binding de POS novo** — o dispositivo antigo desactiva-se em `devices`, o novo
   faz o binding e recebe o seu `device_key_hash`.
4. **Impressoras, gaveta e IPs não mudam.** É só o PC. É exactamente por isto que tudo o resto se manteve
   idêntico entre lojas (§1).

### Ensaio de substituição (uma vez por loja, antes da abertura)

| # | Passo | Meta |
|---|---|---|
| 1 | Windows limpo + Chrome + rede da loja | — |
| 2 | Instalar o `.exe` do bridge e repor o `.env` daquela loja | — |
| 3 | Heartbeat verde no painel **Sistema** | < 2 min |
| 4 | POS instalado como PWA, kiosk, binding do dispositivo | — |
| 5 | Venda de teste: talão sai, comanda sai, gaveta abre | **< 30 min no total** |

Registar data, tempo e quem executou em [`RUNBOOK.md §8`](RUNBOOK.md).

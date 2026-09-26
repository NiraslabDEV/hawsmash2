# Hardware — equipamento, ligações e contingência por loja

> O equipamento é **a cargo do HAWSMASH**; a especificação, instalação e configuração são da Niraslab
> (proposta §9). Este documento é o que se manda ao cliente **antes da compra** e o que se segue na instalação.
> O plano inicial procurava manter rede, impressoras, gaveta e consumíveis iguais nas duas unidades,
> com PCs diferentes (§1.1). O código actual também suporta impressora USB através da fila Windows e
> porta série. A escolha instalada deve constar do registo de cada loja; este documento não certifica
> que o equipamento descrito tenha sido comprado, instalado ou ensaiado.

---

## 1. Lista por loja

| # | Equipamento | Especificação mínima | Porquê |
|---|---|---|---|
| 1 | **PC touch (balcão)** | **Diferente por loja — ver §1.1.** Mínimos: Windows 10/11 **64-bit**, CPU Intel **8.ª geração ou superior**, 8 GB RAM, SSD 128 GB, ecrã touch ≥ 15", **Ethernet** (ou adaptador USB-Ethernet) | Corre o POS (browser) **e** o print-bridge. Ethernet porque Wi-Fi cai primeiro |
| 2 | **Impressora térmica — cozinha** | 80 mm, ESC/POS, Ethernet (RJ45), corte automático. Referência histórica do 1.0: Xprinter XP-T80Q; conferir modelo real | Via destinada à cozinha. O envio continua a depender de um bridge ligado |
| 3 | **Impressora térmica — balcão** | Ethernet como a #2, ou impressora local compatível por fila Windows/porta série, depois de ensaio | Via do balcão e pulso da gaveta; destino definido na configuração |
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
| Sem venda | Nome da marca configurada a atravessar o visor | Texto de boas-vindas configurado |
| Artigo tocado (2,5 s) | nome do artigo | `2 x` · total da linha |
| Carrinho | `3 artigos` | `TOTAL` · valor |
| Pagamento M-Pesa/e-Mola | `M-PESA` · **número da loja** | `A PAGAR` · valor |
| Dinheiro com troco calculado | `RECEBIDO` · valor | `TROCO` · valor |
| Venda concluída | `OBRIGADO!` | `SENHA` · número do dia |

**Instalação (por loja):**

1. Ligar o visor e ver a porta em **Gestor de Dispositivos → Portas (COM e LPT)** (`COM1`, `COM3`…).
2. No `.env` do bridge: `CUSTOMER_DISPLAY_PORT=COM3` (e `CUSTOMER_DISPLAY_BAUD` se não for 9600 — vem no
   manual do visor; 9600 é o mais comum).
3. Reiniciar o bridge. Conferir nome da marca, total, recebido/troco e senha; registar o resultado.
4. Se saírem caracteres estranhos ou nada, trocar `CUSTOMER_DISPLAY_PROTOCOL=cd5220` por `escpos` e repetir.
   São os protocolos implementados. Se nenhum funcionar, identificar o modelo e obter o manual do
   mostrador (**B-018**); não assumir compatibilidade sem teste.

**Sem visor configurado o bridge corre exactamente como antes** — a linha fica vazia no `.env` e nada muda.

### 1.1 PC do balcão — registo histórico e plano por loja

O levantamento anterior registou PCs diferentes. A tabela preserva esse levantamento e o plano,
não uma inspecção efectuada nesta redocumentação. Confirmar inventário, sistema operativo e licenças na instalação.

| | **Maputo** | **Matola** |
|---|---|---|
| Equipamento | a adquirir | **WINTEC AnyPOS100** (variante `1461A`) |
| CPU | Intel 8.ª geração ou superior | Intel Core i5-7200U (2 núcleos / 4 threads, 2.5–3.1 GHz) |
| RAM | 8 GB | 8 GB ✅ |
| SO | Windows 11 | Windows 10 Pro 22H2 · 64-bit |
| Ecrã | ≥ 15", 1920×1080 preferencial | 1366×768 |
| Impressora integrada | conforme o modelo | sim — fila Windows `POS80`, porta `VPORT-USB:` |
| Portas COM | conforme o modelo | **COM1–COM6** (chip série interno). O `Win32_SerialPort` não as enumera — usar `mode` ou `Get-PnpDevice -Class Ports` |
| Actualizações de segurança | verificar no equipamento adquirido | levantamento registou fim de suporte normal em 14/10/2025; confirmar cobertura/licença efectiva |
| Substituição prevista | ~2031 | **2027 — é a primeira a trocar** |

**Porque é a Matola que fica com esta máquina:** Maputo herda todo o histórico do HAWSMASH 1.0 na migração
(`store_id = maputo`, CLAUDE §15) e abre com o volume que já existe. Matola abre do zero.

**Critério de compra do plano original.** Preferia Intel de 8.ª geração ou posterior, em vez dos modelos
mais antigos abaixo. A geração, sozinha, não certifica compatibilidade, suporte nem estado da licença:
confirmar os requisitos oficiais actuais, drivers touch/impressora e política de actualizações antes de comprar.

> O número a seguir a `i3-` / `i5-` / `i7-` tem de **começar por 8 ou mais alto**.
> `i5-8250U` ✅ · `i5-1135G7` ✅ · `i5-7200U` ❌ · `i5-6300U` ❌

**Impressora integrada da Matola.** O plano antigo excluía-a por o bridge só falar TCP; esse limite foi
ultrapassado. [printer-target.ts](../../services/print-bridge/src/printer-target.ts) envia também RAW para
fila Windows e porta série. `PRINTER_COUNTER=windows://POS80` é um exemplo de destino, a substituir pelo
nome exacto da fila instalada; `PRINTER_KITCHEN` pode continuar TCP. Instalar driver/fila, conferir permissões
da conta que corre o serviço e ensaiar papel, corte e gaveta. O suporte no código não prova que a POS80 real funcione.

**Regra de UI que daqui resulta:** o POS desenha-se e valida-se a **1366×768**. O que passa em Matola passa em
Maputo com folga; o contrário não é verdade. Uma só interface — nada de layout condicional por loja.

**Risco assumido (Matola):** Windows 10 sem actualizações de segurança e sem caminho para o Windows 11 (o
i5-7200U é de 7.ª geração, abaixo do requisito de CPU). Mitigações obrigatórias em §3; risco registado em
[runbook, riscos assumidos](runbook.md#8-riscos-assumidos).

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

- Os IPs acima são um plano de rede de exemplo, não endereços verificados. Confirmar a sub-rede antes de os aplicar.
- **Tudo em cabo.** Wi-Fi só para os dispositivos que não vendem. Na opção USB, a impressora do balcão liga-se ao PC;
  precisa da fila Windows e do bridge a correr. A gaveta continua ligada à impressora.

---

## 3. Configuração do PC do balcão

- [ ] Windows: **suspensão desligada**, ecrã sempre ligado, **login automático**, actualizações fora do horário de loja
- [ ] Conta de utilizador só para o balcão (sem instalar nada, sem navegar)
- [ ] Chrome/Edge com o **POS instalado como PWA** e a arrancar em **modo kiosk** com o Windows
- [ ] `print-bridge` instalado como serviço/tarefa agendada, **arranque automático + reinício em falha**
- [ ] Configuração a partir do [exemplo do bridge](../../services/print-bridge/.env.example): Supabase, `STORE_ID`,
  `BRIDGE_DEVICE_ID`, destinos das impressoras, `LOCAL_TOKEN` e `LOCAL_ALLOWED_ORIGINS`
- [ ] Teste de impressão nas duas impressoras + teste de gaveta a partir do POS
- [ ] Antivírus/firewall a permitir a porta `7777` na LAN
- [ ] Etiqueta física no PC com: loja, IPs, contacto de suporte
- [ ] **Cópia cifrada do `.env` e do `.exe` do bridge guardada fora da máquina** (o `.env` tem a service key) — §5.1

**Só na Matola** — mitigações do Windows 10 sem suporte (§1.1). Não são opcionais:

- [ ] Conta do balcão **sem privilégios de administrador**
- [ ] Navegação bloqueada: o Chrome arranca em kiosk na URL do POS e mais nada
- [ ] Sem portas de entrada abertas no router para esta máquina
- [ ] Windows Defender activo (as definições continuam a actualizar mesmo sem patches do SO)
- [ ] AnyDesk, se instalado: acesso não assistido protegido, lista de permissões e **quem tem acesso registado** no [runbook](runbook.md)
- [ ] Nada mais instalado: sem email, sem downloads, sem pens USB

---

## 4. Testes de aceitação (fazer com o equipamento na mão, antes de ir para a loja)

> Este é o guião para o PC touch + gaveta + impressora que o cliente envia para testes.

| # | Teste | Passa quando |
|---|---|---|
| 1 | Venda em dinheiro com troco | Talão sai, gaveta abre, troco correcto no ecrã e no papel |
| 2 | Venda em M-Pesa | Talão sai, gaveta **não** abre |
| 3 | Via da cozinha | Sai na impressora configurada, com senha/itens/notas correctos; preços dependem do modelo: Cozinha não leva, Completo/Compacto levam |
| 4 | **Internet desligada** (tirar o cabo do router) | Venda entra na fila, **talão sai na mesma**, gaveta abre, banner "SEM LIGAÇÃO" |
| 5 | Internet reposta | Fila sincroniza sozinha; **nenhum pedido duplicado** no painel |
| 6 | Impressora desligada durante a venda | Venda gravada continua visível; falha de envio aparece na fila; recuperação/reimpressão verificada e alerta ensaiado se scheduler/SMTP estiverem activos |
| 7 | Reinício do PC a meio do expediente | Tudo arranca sozinho (kiosk + bridge) em menos de 2 min, sem intervenção |
| 8 | Falha de energia com UPS | PC, impressora do balcão e router sobrevivem ≥ 10 min |
| 9 | Anulação de venda | Exige perfil/PIN, repõe stock, fica no histórico com motivo |
| 10 | Abrir gaveta fora de venda | Exige perfil e aparece em `event_log` com quem abriu |

Registar resultado, data, equipamento, configuração e responsável no [runbook](runbook.md) antes da abertura.
O serviço usa uma chave `service_role`, que contorna RLS: o filtro de loja no código não a torna restrita
criptograficamente à loja. Proteger PC, rede e cópia de recuperação; não divulgar a chave ou o token local.

---

## 5. Contingência (o que a equipa faz quando falha)

| Falha | Acção imediata da equipa |
|---|---|
| **Internet em baixo** | Continuar o balcão offline se a sessão/menu já estiverem disponíveis; mesas, entrega e caixa precisam de rede. Não limpar dados do navegador |
| **Impressora sem papel** | Trocar o rolo; conferir o que saiu e a fila. Se o job já consta como impresso, pedir reimpressão identificada; não presumir recuperação automática |
| **Impressora avariada** | Vender e comunicar pedidos à cozinha por papel/transcrição ou ecrã operado pelo balcão/gerente. Não partilhar credenciais; ver [manual da cozinha](manual-cozinha.md) |
| **Gaveta não abre** | Abrir com a chave física (fica com o responsável), registar as vendas na mesma |
| **PC não arranca** | Vender em papel (talonário de reserva) e registar depois; ligar ao suporte |
| **Falha de energia sem UPS** | Talonário de papel; ao voltar, lançar as vendas no POS pelo talonário |

Cada loja tem, em papel, **uma folha A4 plastificada** com esta tabela e o contacto de suporte.


---

## 5.1 PC de substituição — o que substitui o "kit idêntico"

Um PC de reserva pode servir qualquer loja depois de vínculo e configuração correctos; não transporta
automaticamente a fila offline do PC avariado. Sendo uma aplicação web, o POS simplifica a reposição,
mas tempo de preparação, drivers, credenciais e conectividade têm de ser ensaiados:

1. **`.env` do bridge e `.exe` de cada loja guardados fora da máquina, cifrados.** O `.env` tem a service key
   do Supabase; nunca em claro numa drive partilhada.
2. **Procedimento cronometrado uma vez antes da abertura.** Meta: do PC nu ao primeiro talão impresso em
   **menos de 30 minutos**.
3. **`BRIDGE_DEVICE_ID` novo e binding de POS novo** — o dispositivo antigo desactiva-se em `devices`, o novo
   faz o binding e recebe o seu `device_key_hash`.
4. Manter destinos de rede quando aplicável; reinstalar a fila/driver se o balcão usar USB. Confirmar
   impressoras, visor e gaveta antes de voltar a vender. Preservar o PC antigo e recuperar a fila offline com suporte.

### Ensaio de substituição (uma vez por loja, antes da abertura)

| # | Passo | Meta |
|---|---|---|
| 1 | Windows limpo + Chrome + rede da loja | — |
| 2 | Instalar o `.exe` do bridge e repor o `.env` daquela loja | — |
| 3 | Heartbeat verde no painel **Sistema** | < 2 min |
| 4 | POS instalado como PWA, kiosk, binding do dispositivo | — |
| 5 | Venda de teste: talão sai, comanda sai, gaveta abre | **< 30 min no total** |

Registar data, tempo e quem executou no [runbook](runbook.md#8-riscos-assumidos). Ver também
[Instalação](instalacao.md) e [Impressão](../modulos/impressao.md).

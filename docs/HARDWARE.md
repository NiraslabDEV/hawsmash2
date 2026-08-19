# HARDWARE.md — equipamento, ligações e contingência (por loja)

> O equipamento é **a cargo do HAWSMASH**; a especificação, instalação e configuração são da Niraslab
> (proposta §9). Este documento é o que se manda ao cliente **antes da compra** e o que se segue na instalação.
> **Cada loja leva um conjunto completo e idêntico** — a equipa de uma tem de conseguir socorrer a outra.

---

## 1. Lista por loja

| # | Equipamento | Especificação mínima | Porquê |
|---|---|---|---|
| 1 | **PC touch (balcão)** | Windows 10/11, 8 GB RAM, SSD 128 GB, ecrã touch ≥ 15", **Ethernet** (ou adaptador USB-Ethernet) | Corre o POS (browser) **e** o print-bridge. Ethernet porque Wi-Fi cai primeiro |
| 2 | **Impressora térmica — cozinha** | 80 mm, ESC/POS, **Ethernet (RJ45)**, corte automático. Ref.: **Xprinter XP-T80Q** (já validada no HAWSMASH 1.0) | Comanda da cozinha. Rede em vez de USB → não depende do PC estar aberto |
| 3 | **Impressora térmica — balcão** | igual à #2 | Talão do cliente **e** comando da gaveta |
| 4 | **Gaveta de dinheiro** | metálica, **RJ11/RJ12**, 12 V ou 24 V — **tem de coincidir com a impressora #3** | Abre pelo pulso ESC/POS da impressora do balcão |
| 5 | **Switch de rede** | 5 portas, gigabit | Liga PC + 2 impressoras + router |
| 6 | **Router principal** | do ISP, com porta LAN livre | Internet da loja |
| 7 | **Router/modem 4G de reserva** | com **failover automático** (ou router dual-WAN) + SIM com dados | Compromisso da proposta §9: o balcão não pode parar |
| 8 | **UPS (nobreak)** | ≥ 650 VA, ligado a PC + impressora do balcão + switch + router | **Falha de energia é o risco mais comum em Maputo.** Sem UPS, corte de luz = venda perdida e caixa por fechar |
| 9 | **TV** (opcional na abertura) | qualquer TV com HDMI + **box Android** (ou mini-PC) com browser em modo kiosk | Menu board e ecrã de senhas |
| 10 | **Consumíveis** | rolos de papel térmico 80 mm × 80 mm — **stock para 1 mês por loja** | Ficar sem papel a meio de um sábado |

> **Cartão:** o terminal (POS bancário) é do banco e continua separado. O sistema apenas **regista** que o
> pagamento foi em cartão — não comunica com o terminal. Confirmar com o cliente antes da abertura.

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

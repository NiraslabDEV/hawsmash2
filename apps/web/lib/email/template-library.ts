import type { EmailStep } from "./studio";

export type EmailTemplate = {
  id: string;
  name: string;
  category: "Essenciais" | "Relacionamento" | "Campanhas";
  description: string;
  step: EmailStep;
};
const make = (
  id: string,
  name: string,
  category: EmailTemplate["category"],
  theme: EmailStep["theme"],
  subject: string,
  heading: string,
  text: string,
  cta?: string,
): EmailTemplate => ({
  id,
  name,
  category,
  description: text,
  step: {
    theme,
    subject,
    preheader: heading,
    delay_minutes: 0,
    blocks: [
      { type: "heading", text: heading },
      { type: "text", text },
      ...(cta
        ? [{ type: "button" as const, text: cta, url: "{{menu_url}}" }]
        : []),
      { type: "divider" },
      { type: "text", text: "Até já,\nA equipa {{loja}}" },
    ],
  },
});
export const EMAIL_TEMPLATES: EmailTemplate[] = [
  make(
    "essential",
    "Essencial",
    "Essenciais",
    "classic",
    "Uma mensagem de {{loja}}",
    "{{loja}}",
    "Olá, {{nome}}. Temos uma mensagem para ti.",
  ),
  make(
    "signature",
    "Assinatura dourada",
    "Essenciais",
    "gold",
    "Novidades de {{loja}}",
    "Bom ter-te por aqui",
    "Olá, {{nome}}. Obrigado por fazeres parte da nossa comunidade.",
    "Ver o menu",
  ),
  make(
    "dark",
    "Noite e dourado",
    "Essenciais",
    "dark",
    "O sabor de {{loja}}",
    "A tua próxima pausa começa aqui",
    "Um convite para abrandar e escolher o que te apetece hoje.",
    "Escolher no menu",
  ),
  make(
    "letter",
    "Carta da equipa",
    "Essenciais",
    "editorial",
    "Uma nota da equipa {{loja}}",
    "Olá, {{nome}}",
    "Há sempre lugar para mais uma boa conversa à mesa. Obrigado por nos acompanhares.",
  ),
  make(
    "welcome",
    "Boas-vindas",
    "Relacionamento",
    "gold",
    "Bem-vindo à {{loja}}",
    "Ainda bem que chegaste",
    "Por aqui partilhamos novidades, sabores e convites para voltar. Começa por conhecer o nosso menu.",
    "Conhecer o menu",
  ),
  make(
    "thanks",
    "Obrigado pela visita",
    "Relacionamento",
    "classic",
    "Obrigado por escolheres {{loja}}",
    "Até à próxima visita",
    "Foi um gosto receber-te. Quando voltares a ter vontade, sabes onde nos encontrar.",
    "Voltar ao menu",
  ),
  make(
    "return",
    "Convite para voltar",
    "Relacionamento",
    "editorial",
    "Voltamos a encontrar-nos na {{loja}}?",
    "Guardamos-te um lugar",
    "Olá, {{nome}}. Fica o convite para a tua próxima visita. Escolhe o que te apetece e conta connosco.",
    "Escolher o meu pedido",
  ),
  make(
    "community",
    "Da nossa comunidade",
    "Relacionamento",
    "classic",
    "Conversas à mesa da {{loja}}",
    "O que te traz à nossa mesa?",
    "Gostamos de saber o que mais aprecias nas tuas visitas. Responde a este email e conta-nos.",
  ),
  make(
    "menu",
    "Descobrir o menu",
    "Campanhas",
    "dark",
    "O teu próximo pedido na {{loja}}",
    "Abre espaço para o teu favorito",
    "Explora o menu e escolhe a combinação que combina com a tua fome de hoje.",
    "Explorar o menu",
  ),
  make(
    "weekend",
    "Convite de fim-de-semana",
    "Campanhas",
    "gold",
    "Um plano para o fim-de-semana",
    "Boa companhia, boa mesa",
    "Combina uma pausa com quem gostas. Consulta o menu e prepara a tua próxima visita à {{loja}}.",
    "Ver o menu",
  ),
  make(
    "launch",
    "Apresentar uma novidade",
    "Campanhas",
    "editorial",
    "Há novidades na {{loja}}",
    "Uma nova razão para nos visitar",
    "Descobre o que preparámos para a tua próxima visita. As opções disponíveis estão no menu.",
    "Descobrir as opções",
  ),
  make(
    "reminder",
    "Lembrete gentil",
    "Campanhas",
    "classic",
    "Fica o convite da {{loja}}",
    "Quando te apetecer, estamos por aqui",
    "Olá, {{nome}}. Passamos só para deixar o convite para a tua próxima pausa. Sem pressa: escolhe ao teu ritmo.",
    "Abrir o menu",
  ),
];
export function applyLibraryTemplate(
  id: string,
  previous: EmailStep,
  operational = false,
): EmailStep {
  const template = EMAIL_TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error("Modelo desconhecido");
  const step = structuredClone(template.step);
  step.delay_minutes = previous.delay_minutes;
  if (operational) {
    // O modelo altera apresentação e texto; nunca substitui valores, código ou relatório.
    step.subject = "{{assunto_original}}";
    step.preheader = "";
    step.blocks = [
      { type: "heading", text: "{{loja}}" },
      { type: "system" },
      { type: "divider" },
      { type: "text", text: "A equipa {{loja}}" },
    ];
  }
  return step;
}

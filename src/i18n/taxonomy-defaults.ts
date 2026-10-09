/**
 * La taxonomie par défaut et les libellés spéciaux, dans chaque langue.
 * Sert à deux choses : proposer des catégories à une nouvelle installation, et renommer au changement de langue
 * les catégories dont le nom est encore celui par défaut (un nom personnalisé n'est jamais touché).
 * Les noms français sont, à l'octet près, ceux de config/taxonomy.json : c'est ce qui permet de les reconnaître.
 */
import type { Settings } from "../config.js";
import type { Language } from "./index.js";

export interface DefaultCategory { name: string; criteria: string }
export const DEFAULT_TAXONOMY: Record<Language, Record<string, DefaultCategory>> = {
  fr: {
    clients: { name: "Clients", criteria: "Échanges avec des clients, prospects ou partenaires identifiés : projets, devis, retours produit, support." },
    finance: { name: "Finance", criteria: "Factures, reçus, relevés bancaires, paiements, comptabilité, TVA, fiscalité d'entreprise." },
    admin_legal: { name: "Admin & Légal", criteria: "Impôts personnels, assurances, contrats, administrations publiques, documents officiels." },
    famille_ecole: { name: "Famille · École", criteria: "École des enfants : enseignants, direction, sorties, cantine, autorisations, bulletins, plateforme scolaire." },
    famille_activites: { name: "Famille · Activités", criteria: "Clubs de sport, cours, stages, compétitions, convocations, activités des enfants." },
    voyages: { name: "Voyages", criteria: "Réservations, billets, cartes d'embarquement, hôtels, locations, transports." },
    newsletters: { name: "Newsletters", criteria: "Contenus éditoriaux envoyés à une liste : lettres d'information, articles, veille, à laquelle on s'est abonné." },
    notifications: { name: "Notifications", criteria: "Messages automatiques d'outils et de services : alertes, confirmations, rapports, sécurité, GitHub, Vercel, SaaS." },
    promotions: { name: "Promotions", criteria: "Offres commerciales, marketing, publicité, démarchage, soldes." },
    maison: { name: "Maison", criteria: "Travaux, jardin, entretien, eau, électricité, fournisseurs de la maison." },
    business_dev: { name: "Business Dev", criteria: "Networking, projets annexes, partenariats, opportunités." },
    loisirs: { name: "Loisirs", criteria: "Sport, sorties, hobbies, activités en famille." },
    achats_materiel: { name: "Achats materiel", criteria: "Documents importants liés aux achats de matériel : outils, bricolage, électronique. Exclut les publicités et newsletters." },
  },
  en: {
    clients: { name: "Clients", criteria: "Exchanges with identified clients, prospects or partners: projects, quotes, product feedback, support." },
    finance: { name: "Finance", criteria: "Invoices, receipts, bank statements, payments, accounting, VAT, business taxes." },
    admin_legal: { name: "Admin & Legal", criteria: "Personal taxes, insurance, contracts, public administrations, official documents." },
    famille_ecole: { name: "Family · School", criteria: "The children's school: teachers, management, outings, canteen, permission slips, reports, school platform." },
    famille_activites: { name: "Family · Activities", criteria: "Sports clubs, lessons, camps, competitions, call-ups, children's activities." },
    voyages: { name: "Travel", criteria: "Bookings, tickets, boarding passes, hotels, rentals, transport." },
    newsletters: { name: "Newsletters", criteria: "Editorial content sent to a list: newsletters, articles, industry watch, that one subscribed to." },
    notifications: { name: "Notifications", criteria: "Automatic messages from tools and services: alerts, confirmations, reports, security, GitHub, Vercel, SaaS." },
    promotions: { name: "Promotions", criteria: "Commercial offers, marketing, advertising, cold outreach, sales." },
    maison: { name: "Home", criteria: "Works, garden, maintenance, water, electricity, home suppliers." },
    business_dev: { name: "Business Dev", criteria: "Networking, side projects, partnerships, opportunities." },
    loisirs: { name: "Leisure", criteria: "Sport, outings, hobbies, family activities." },
    achats_materiel: { name: "Equipment purchases", criteria: "Important documents about equipment purchases: tools, DIY, electronics. Excludes ads and newsletters." },
  },
  es: {
    clients: { name: "Clientes", criteria: "Intercambios con clientes, prospectos o socios identificados: proyectos, presupuestos, opiniones sobre el producto, soporte." },
    finance: { name: "Finanzas", criteria: "Facturas, recibos, extractos bancarios, pagos, contabilidad, IVA, fiscalidad de empresa." },
    admin_legal: { name: "Admin y Legal", criteria: "Impuestos personales, seguros, contratos, administraciones públicas, documentos oficiales." },
    famille_ecole: { name: "Familia · Colegio", criteria: "Colegio de los niños: profesores, dirección, salidas, comedor, autorizaciones, boletines, plataforma escolar." },
    famille_activites: { name: "Familia · Actividades", criteria: "Clubes deportivos, clases, campamentos, competiciones, convocatorias, actividades de los niños." },
    voyages: { name: "Viajes", criteria: "Reservas, billetes, tarjetas de embarque, hoteles, alquileres, transportes." },
    newsletters: { name: "Boletines", criteria: "Contenido editorial enviado a una lista: boletines, artículos, seguimiento, a los que uno se ha suscrito." },
    notifications: { name: "Notificaciones", criteria: "Mensajes automáticos de herramientas y servicios: alertas, confirmaciones, informes, seguridad, GitHub, Vercel, SaaS." },
    promotions: { name: "Promociones", criteria: "Ofertas comerciales, marketing, publicidad, prospección, rebajas." },
    maison: { name: "Casa", criteria: "Obras, jardín, mantenimiento, agua, electricidad, proveedores de la casa." },
    business_dev: { name: "Business Dev", criteria: "Networking, proyectos paralelos, colaboraciones, oportunidades." },
    loisirs: { name: "Ocio", criteria: "Deporte, salidas, aficiones, actividades en familia." },
    achats_materiel: { name: "Compras de material", criteria: "Documentos importantes sobre compras de material: herramientas, bricolaje, electrónica. Excluye publicidad y boletines." },
  },
};

export const DEFAULT_SPECIAL_LABELS: Record<Language, Settings["specialLabels"]> = {
  fr: { review: "À revoir", reply: "À répondre", toPay: "À payer", suspect: "Suspect", important: "Important" },
  en: { review: "To review", reply: "To reply", toPay: "To pay", suspect: "Suspicious", important: "Important" },
  es: { review: "Por revisar", reply: "Por responder", toPay: "Por pagar", suspect: "Sospechoso", important: "Importante" },
};

/** La taxonomie d'une nouvelle installation, dans la langue donnée (couleurs Gmail lisibles, deux niveaux possibles ensuite). */
export function defaultTaxonomy(lang: Language): { prefix: string; categories: Array<{ key: string; name: string; criteria: string; color: { background: string; text: string }; attention: boolean }> } {
  const colors: Record<string, { background: string; text: string; attention: boolean }> = {
    clients: { background: "#c9daf8", text: "#1c4587", attention: true },
    finance: { background: "#b9e4d0", text: "#0b4f30", attention: true },
    admin_legal: { background: "#e4d7f5", text: "#41236d", attention: true },
    famille_ecole: { background: "#ffe6c7", text: "#7a4706", attention: true },
    famille_activites: { background: "#fce8b3", text: "#684e07", attention: true },
    voyages: { background: "#c6f3de", text: "#04502e", attention: true },
    newsletters: { background: "#fcdee8", text: "#711a36", attention: false },
    notifications: { background: "#efefef", text: "#464646", attention: false },
    promotions: { background: "#efefef", text: "#666666", attention: false },
    maison: { background: "#fef1d1", text: "#7a2e0b", attention: true },
    business_dev: { background: "#f6c5be", text: "#8a1c0a", attention: true },
    loisirs: { background: "#b6cff5", text: "#0d3472", attention: true },
    achats_materiel: { background: "#98d7e4", text: "#0d3b44", attention: true },
  };
  return { prefix: "AI", categories: Object.entries(DEFAULT_TAXONOMY[lang]).map(([key, d]) => ({ key, name: d.name, criteria: d.criteria, color: { background: colors[key].background, text: colors[key].text }, attention: colors[key].attention })) };
}

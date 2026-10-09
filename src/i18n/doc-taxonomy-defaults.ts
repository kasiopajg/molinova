/**
 * La taxonomie documents par défaut, dans la langue de l'app. Deux axes à ne jamais mélanger :
 * le Type dit ce qu'EST le document (même forme quel que soit le domaine), le Contexte dit le DOMAINE DE VIE.
 * Test : chaque Type doit pouvoir se croiser avec plusieurs Contextes ; « Médical » ou « Scolaire » sont des Contextes.
 */
import type { Language } from "./index.js";

type Entry = [key: string, name: string, criteria: string];
type CtxEntry = [key: string, name: string, criteria: string, parent?: string];

const TYPES: Record<Language, Entry[]> = {
  fr: [
    ["identity", "Pièce d'identité", "Carte d'identité, passeport, titre de séjour, permis de conduire, carte vitale ou de santé."],
    ["civil", "Acte civil", "Acte de naissance, de mariage, livret de famille, jugement, PACS, décès."],
    ["contract", "Contrat", "Contrat signé ou conditions générales : bail, assurance, travail, abonnement, prêt, vente."],
    ["amendment", "Avenant", "Modification d'un contrat existant, renouvellement, résiliation."],
    ["invoice", "Facture", "Facture à payer ou payée : montant, numéro de facture, TVA."],
    ["quote", "Devis", "Devis, proposition de prix, offre commerciale avant achat."],
    ["receipt", "Reçu", "Reçu, ticket, preuve de paiement, confirmation de commande."],
    ["statement", "Relevé", "Relevé de compte, de carte, de prêt, d'épargne, de retraite ; décompte."],
    ["certificate", "Attestation / certificat", "Attestation d'assurance, de domicile, de scolarité, certificat médical, diplôme."],
    ["notice", "Avis", "Avis d'imposition, d'échéance, de passage, mise en demeure, convocation."],
    ["payslip", "Bulletin de paie", "Fiche de paie, nómina, salaire mensuel."],
    ["prescription", "Ordonnance", "Ordonnance, prescription médicale."],
    ["report", "Compte rendu / résultat", "Compte rendu médical, résultat d'analyse, bulletin scolaire, rapport d'expertise."],
    ["form", "Formulaire", "Formulaire vierge ou rempli, demande, déclaration à envoyer."],
    ["letter", "Courrier", "Lettre reçue ou envoyée qui n'entre dans aucun autre type."],
    ["warranty", "Garantie / notice", "Garantie, mode d'emploi, notice d'un appareil."],
    ["note", "Note", "Notes personnelles, listes, brouillons, documents de travail."],
    ["other", "Autre", "Aucun type ci-dessus ne convient."],
  ],
  en: [
    ["identity", "ID document", "ID card, passport, residence permit, driving licence, health insurance card."],
    ["civil", "Civil record", "Birth or marriage certificate, family record book, court ruling, civil partnership, death."],
    ["contract", "Contract", "Signed contract or terms: lease, insurance, employment, subscription, loan, sale."],
    ["amendment", "Amendment", "Change to an existing contract, renewal, termination."],
    ["invoice", "Invoice", "Invoice to pay or paid: amount, invoice number, VAT."],
    ["quote", "Quote", "Quote, price proposal, offer before buying."],
    ["receipt", "Receipt", "Receipt, ticket, proof of payment, order confirmation."],
    ["statement", "Statement", "Bank, card, loan, savings or pension statement; account summary."],
    ["certificate", "Certificate", "Insurance certificate, proof of address, school enrolment, medical certificate, diploma."],
    ["notice", "Notice", "Tax assessment, due-date notice, formal notice, summons."],
    ["payslip", "Payslip", "Payslip, monthly salary statement."],
    ["prescription", "Prescription", "Medical prescription."],
    ["report", "Report / result", "Medical report, lab result, school report, expert report."],
    ["form", "Form", "Blank or filled-in form, application, declaration to send."],
    ["letter", "Letter", "Letter received or sent that fits no other type."],
    ["warranty", "Warranty / manual", "Warranty, user manual, device leaflet."],
    ["note", "Note", "Personal notes, lists, drafts, working documents."],
    ["other", "Other", "None of the types above fits."],
  ],
  es: [
    ["identity", "Documento de identidad", "DNI, pasaporte, NIE o permiso de residencia, carné de conducir, tarjeta sanitaria."],
    ["civil", "Acta civil", "Partida de nacimiento o de matrimonio, libro de familia, sentencia, pareja de hecho, defunción."],
    ["contract", "Contrato", "Contrato firmado o condiciones: alquiler, seguro, trabajo, suscripción, préstamo, compraventa."],
    ["amendment", "Anexo", "Modificación de un contrato, renovación, rescisión."],
    ["invoice", "Factura", "Factura por pagar o pagada: importe, número de factura, IVA."],
    ["quote", "Presupuesto", "Presupuesto, propuesta de precio, oferta antes de comprar."],
    ["receipt", "Recibo", "Recibo, ticket, justificante de pago, confirmación de pedido."],
    ["statement", "Extracto", "Extracto bancario, de tarjeta, de préstamo, de ahorro o de pensión."],
    ["certificate", "Certificado", "Certificado de seguro, de empadronamiento, de escolaridad, certificado médico, título."],
    ["notice", "Notificación", "Notificación de Hacienda, aviso de vencimiento, requerimiento, citación."],
    ["payslip", "Nómina", "Nómina, recibo de salario mensual."],
    ["prescription", "Receta", "Receta médica."],
    ["report", "Informe / resultado", "Informe médico, resultado de análisis, boletín de notas, peritaje."],
    ["form", "Formulario", "Formulario en blanco o rellenado, solicitud, declaración por enviar."],
    ["letter", "Carta", "Carta recibida o enviada que no encaja en otro tipo."],
    ["warranty", "Garantía / manual", "Garantía, manual de uso, folleto de un aparato."],
    ["note", "Nota", "Notas personales, listas, borradores, documentos de trabajo."],
    ["other", "Otro", "Ningún tipo de arriba encaja."],
  ],
};

const CONTEXTS: Record<Language, CtxEntry[]> = {
  fr: [
    ["home", "Maison", "Le logement : achat, location, travaux, copropriété."],
    ["home_insurance", "Assurance maison", "Assurance habitation, multirisque.", "home"],
    ["home_utilities", "Énergie et services", "Électricité, gaz, eau, internet, téléphone fixe.", "home"],
    ["home_loan", "Prêt et loyer", "Prêt immobilier, bail, quittances de loyer.", "home"],
    ["car", "Voiture", "Les véhicules : achat, carte grise, entretien, amendes."],
    ["car_insurance", "Assurance voiture", "Assurance auto ou moto, constat.", "car"],
    ["health", "Santé", "Médecins, hôpital, mutuelle, remboursements, vaccins."],
    ["school", "École", "Scolarité des enfants : inscriptions, bulletins, cantine, activités."],
    ["bank", "Banque et finances", "Comptes, cartes, épargne, placements, crédits hors logement."],
    ["taxes", "Impôts", "Impôt sur le revenu, taxes locales, déclarations fiscales."],
    ["work", "Travail", "Emploi, entreprise, salaire, chômage, retraite."],
    ["admin", "Administratif", "Identité, état civil, démarches officielles, résidence."],
    ["family", "Famille", "Vie de famille hors santé et école : garde, loisirs, événements."],
    ["leisure", "Loisirs", "Sport, clubs et associations, permis de chasse ou de pêche, cours, abonnements culturels."],
    ["travel", "Voyages", "Billets, réservations, visas, assurances voyage."],
    ["purchases", "Achats", "Achats et appareils : factures, garanties, notices."],
    ["other", "Autre", "Aucun contexte ci-dessus ne convient."],
  ],
  en: [
    ["home", "Home", "Housing: purchase, rental, works, building management."],
    ["home_insurance", "Home insurance", "Home or contents insurance.", "home"],
    ["home_utilities", "Utilities", "Electricity, gas, water, internet, landline.", "home"],
    ["home_loan", "Mortgage and rent", "Mortgage, lease, rent receipts.", "home"],
    ["car", "Car", "Vehicles: purchase, registration, servicing, fines."],
    ["car_insurance", "Car insurance", "Car or motorbike insurance, accident report.", "car"],
    ["health", "Health", "Doctors, hospital, health insurance, refunds, vaccines."],
    ["school", "School", "Children's schooling: enrolment, reports, canteen, activities."],
    ["bank", "Banking and finance", "Accounts, cards, savings, investments, loans other than housing."],
    ["taxes", "Taxes", "Income tax, local taxes, tax returns."],
    ["work", "Work", "Employment, company, salary, unemployment, pension."],
    ["admin", "Administration", "Identity, civil status, official procedures, residence."],
    ["family", "Family", "Family life other than health and school: childcare, leisure, events."],
    ["leisure", "Leisure", "Sport, clubs and associations, hunting or fishing licences, classes, cultural memberships."],
    ["travel", "Travel", "Tickets, bookings, visas, travel insurance."],
    ["purchases", "Purchases", "Purchases and devices: invoices, warranties, manuals."],
    ["other", "Other", "None of the contexts above fits."],
  ],
  es: [
    ["home", "Casa", "La vivienda: compra, alquiler, obras, comunidad."],
    ["home_insurance", "Seguro de hogar", "Seguro de hogar, multirriesgo.", "home"],
    ["home_utilities", "Suministros", "Luz, gas, agua, internet, teléfono fijo.", "home"],
    ["home_loan", "Hipoteca y alquiler", "Hipoteca, contrato de alquiler, recibos del alquiler.", "home"],
    ["car", "Coche", "Vehículos: compra, permiso de circulación, mantenimiento, multas."],
    ["car_insurance", "Seguro del coche", "Seguro de coche o moto, parte amistoso.", "car"],
    ["health", "Salud", "Médicos, hospital, mutua, reembolsos, vacunas."],
    ["school", "Colegio", "Escolaridad de los niños: matrícula, notas, comedor, actividades."],
    ["bank", "Banco y finanzas", "Cuentas, tarjetas, ahorro, inversiones, préstamos que no son de vivienda."],
    ["taxes", "Impuestos", "Renta, impuestos locales, declaraciones."],
    ["work", "Trabajo", "Empleo, empresa, salario, paro, jubilación."],
    ["admin", "Administración", "Identidad, estado civil, trámites oficiales, residencia."],
    ["family", "Familia", "Vida familiar fuera de salud y colegio: custodia, ocio, eventos."],
    ["leisure", "Ocio", "Deporte, clubes y asociaciones, licencias de caza o pesca, cursos, abonos culturales."],
    ["travel", "Viajes", "Billetes, reservas, visados, seguros de viaje."],
    ["purchases", "Compras", "Compras y aparatos: facturas, garantías, manuales."],
    ["other", "Otro", "Ningún contexto de arriba encaja."],
  ],
};

export interface DocType { key: string; name: string; criteria: string }
export interface DocContext { key: string; name: string; criteria: string; parent?: string }
export interface DocTaxonomy { types: DocType[]; contexts: DocContext[] }

export function defaultDocTaxonomy(lang: Language): DocTaxonomy {
  return {
    types: TYPES[lang].map(([key, name, criteria]) => ({ key, name, criteria })),
    contexts: CONTEXTS[lang].map(([key, name, criteria, parent]) => ({ key, name, criteria, ...(parent ? { parent } : {}) })),
  };
}

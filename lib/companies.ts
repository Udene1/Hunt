export type CompanySeed = {
  name: string;
  domain: string;
  description: string;
  sectors: string[];
};

export const COMPANY_CATALOG: CompanySeed[] = [
  { name: "Dangote Refinery", domain: "refinery.dangote.com", description: "Petroleum refining, petrochemicals and related industrial infrastructure; canonical refinery site seeded for investigation.", sectors: ["Energy", "Oil and gas", "Refining", "Petrochemicals", "Industrial infrastructure"] },
  { name: "Dangote Group", domain: "dangote.com", description: "Corporate group website; related corporate domain, not interchangeable with the refinery operating site.", sectors: ["Conglomerate", "Industrial", "Manufacturing", "Energy"] },
  { name: "Flutterwave", domain: "flutterwave.com", description: "Payments infrastructure and commerce technology.", sectors: ["Fintech", "Payments", "Infrastructure"] },
  { name: "Moniepoint", domain: "moniepoint.com", description: "Payments, banking, credit and business management infrastructure.", sectors: ["Fintech", "Banking", "Payments"] },
  { name: "Kora", domain: "korapay.com", description: "Payments infrastructure for businesses operating across Africa.", sectors: ["Fintech", "Payments", "Infrastructure"] },
  { name: "Paystack", domain: "paystack.com", description: "Payments technology for African businesses.", sectors: ["Fintech", "Payments", "API"] },
  { name: "PiggyVest", domain: "piggyvest.com", description: "Digital savings and investment products.", sectors: ["Fintech", "Consumer", "Savings"] },
  { name: "Interswitch", domain: "interswitchgroup.com", description: "Payments and transaction processing infrastructure.", sectors: ["Fintech", "Payments", "Infrastructure"] },
  { name: "OPay", domain: "opay.ltd", description: "Consumer and merchant financial services.", sectors: ["Fintech", "Payments", "Consumer"] },
  { name: "PalmPay", domain: "palmpay.com", description: "Digital payments and financial services.", sectors: ["Fintech", "Payments", "Consumer"] },
  { name: "Andela", domain: "andela.com", description: "Distributed engineering talent and technology services.", sectors: ["Technology", "Engineering", "Talent"] },
  { name: "MainOne", domain: "mainone.net", description: "Connectivity and data-centre infrastructure.", sectors: ["Infrastructure", "Cloud", "Connectivity"] },
  { name: "Moove", domain: "moove.io", description: "Mobility and financial access infrastructure for drivers.", sectors: ["Mobility", "Fintech", "Transport"] },
  { name: "TradeDepot", domain: "tradedepot.co", description: "Commerce infrastructure connecting retailers and suppliers.", sectors: ["Commerce", "Logistics", "Supply chain"] },
];

export function normalizeCompany(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function findCompany(value: string) {
  const q = value.trim().toLowerCase();
  return COMPANY_CATALOG.find(
    (c) => c.name.toLowerCase() === q || c.domain.toLowerCase() === q
  );
}

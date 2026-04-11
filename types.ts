export enum ScanStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export type ContactType = 'person' | 'generic' | 'none';

export interface Segment {
  id: string;
  name: string; // Např. "E-commerce", "Stavebnictví"
  description: string; // Proč to AI zařadila sem
  userNotes?: string; 
  // Generic fields removed/ignored in logic now
}

export interface EnrichedData {
  email: string | null;
  personName: string | null; // Celé jméno (pro zobrazení v UI)
  firstName: string | null;  // Křestní jméno (pro export)
  lastName: string | null;   // Příjmení (pro export)
  personRole: string | null; // Role osoby
  salutation: string | null; // Oslovení (Vážený pane Nováku / Dobrý den)
  companyContext: string | null; // Co firma dělá (z webu)
  ico: string | null; // Nalezené IČO
  language: string | null; // Detekovaný jazyk (cs, de, en...)
  
  // New classification field
  contactType: ContactType; 
  
  // New fields for lead overview and rating
  overview?: string;
  icebreaker?: string;
  rating?: number;
  location?: string | null; // Sídlo / Stát
  
  groundingSources?: { uri: string; title?: string }[]; // Zdroje informací z Google Search
}

export interface ScanResult {
  id: string;
  url: string;
  status: ScanStatus;
  originalRow?: Record<string, string>;
  
  // Analýza
  segmentId?: string;

  // Resilience
  retryCount?: number; // Počet pokusů o zpracování

  // Výsledky z webu & AI
  enrichedData?: EnrichedData;
  error?: string;
  syncedToSheets?: boolean; // Indikátor, zda bylo uloženo na Drive
}

export interface InputItem {
  url: string;
  originalRow?: Record<string, string>;
}

export interface AppSettings {
  googleSheetUrl?: string;
  autoSync: boolean;
  idealClientProfile?: string;
  serviceDescription?: string;
  searchEmails?: boolean;
}
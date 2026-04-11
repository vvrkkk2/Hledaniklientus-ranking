import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { EnrichedData, Segment, ContactType } from "../types";

// Modely
// Gemini 2.0 Flash je momentálně nejrobustnější "workhorse" model.
const PRIMARY_MODEL = "gemini-2.0-flash";
// Jako fallback použijeme Lite verzi, pokud je hlavní přetížená.
const FALLBACK_MODEL = "gemini-2.0-flash-lite-preview-02-05"; 

// Helper to initialize client ONLY when needed.
const getAiClient = () => {
  const key = process.env.API_KEY;
  if (!key) {
    console.error("API Key is missing!");
    throw new Error("API Key is missing. Please check your Vercel Environment Variables.");
  }
  return new GoogleGenAI({ apiKey: key });
};

const cleanJson = (text: string): string => {
    if (!text) return "{}";
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return text.substring(firstBrace, lastBrace + 1);
    }
    let clean = text.trim();
    if (clean.startsWith('```json')) clean = clean.substring(7);
    else if (clean.startsWith('```')) clean = clean.substring(3);
    if (clean.endsWith('```')) clean = clean.substring(0, clean.length - 3);
    return clean.trim();
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const retryWithBackoff = async <T>(
  operation: () => Promise<T>, 
  retries = 3, 
  baseDelay = 5000 
): Promise<T> => {
  try {
    return await operation();
  } catch (error: any) {
    const msg = JSON.stringify(error).toLowerCase();
    // Detekce přetížení API (503) nebo Rate Limitu (429)
    const isOverloaded = msg.includes('503') || error?.status === 503 || msg.includes('overloaded') || msg.includes('429') || msg.includes('resource exhausted');
    
    if (retries > 0 && isOverloaded) {
      const waitTime = baseDelay * 2; // Exponenciální čekání (10s, 20s, 40s...)
      console.warn(`Model overloaded (503/429). Cooling down for ${waitTime}ms... (${retries} attempts left)`);
      await sleep(waitTime);
      return retryWithBackoff(operation, retries - 1, waitTime);
    }
    throw error;
  }
};

/**
 * 1. FÁZE: SEGMENTACE
 */
export const analyzeSegments = async (rows: Record<string, string>[]): Promise<Segment[]> => {
  const sample = rows.slice(0, 20).map(r => JSON.stringify(r)).join("\n");

  const prompt = `
    Jsi datový analytik. Analyzuj tento seznam firem (CSV data).
    Rozděl je do 3-5 kategorií podle oboru (např. E-shopy, Stavebnictví, Marketing, Průmysl).
    
    Data: ${sample}
    Vrať JSON pole segmentů [{ "id": "...", "name": "...", "description": "..." }].
  `;

  try {
    const ai = getAiClient();
    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents: prompt,
          config: { responseMimeType: "application/json" }
    }), 2, 2000);
    return JSON.parse(cleanJson(response.text || "[]"));
  } catch (e) {
    console.error("Segment analysis failed:", e);
    return [{ id: "default", name: "Seznam firem", description: "Všechny firmy" }];
  }
};

export const classifyRow = async (row: Record<string, string>, segments: Segment[]): Promise<string> => {
    if (segments.length <= 1) return segments[0]?.id || 'default';
    return segments[0].id; 
}


/**
 * 2. FÁZE: HLEDÁNÍ KONTAKTU
 */
export const processContact = async (
  url: string, 
  originalRow: Record<string, string> | undefined,
  segment: Segment,
  idealClientProfile?: string,
  serviceDescription?: string
): Promise<EnrichedData> => {
  
  const contextData = originalRow ? JSON.stringify(originalRow) : "";

  const combinedPrompt = `
    ÚKOL: Najdi kontaktní údaje pro firmu PROCHÁZENÍM WEBU: ${url}
    
    Data z CSV pro kontext: ${contextData}
    Segment: ${segment.name}
    ${idealClientProfile ? `Požadavek na ideálního klienta: ${idealClientProfile}` : ''}
    ${serviceDescription ? `Popis naší služby: ${serviceDescription}` : ''}

    INSTRUKCE PRO HLEDÁNÍ:
    1. Použij Google Search Grounding k prozkoumání webové stránky ${url}.
    2. Hledej sekce "Kontakty", "O nás", "Tým", "Vedení společnosti".
    3. Hledej JMENOVITÉ emaily (např. jmeno.prijmeni@firma.cz). Toto je priorita.
    4. Pokud nenajdeš osobu, hledej obecný email (info@, kontakt@).

    INSTRUKCE PRO ZPRACOVÁNÍ DAT:
    1. Pokud najdeš osobu, ROZDĚL jméno na:
       - firstName (Křestní jméno)
       - lastName (Příjmení - bez titulů)
    2. VYTVOŘ OSLOVENÍ (salutation):
       - Pokud máš jméno, vytvoř formální české oslovení v 5. pádě (vokativ).
       - Příklady: Jan Novák -> "Vážený pane Nováku", Marie Svobodová -> "Vážená paní Svobodová".
       - Pokud jméno nemáš, použij: "Dobrý den".

    3. KLASIFIKACE (contactType):
       - "person": Máš jméno osoby a email (osobní nebo malá firma).
       - "generic": Máš jen obecný email (info@).
       - "none": Nemáš email.

    4. ANALÝZA LEADU (pokud je zadán profil ideálního klienta a popis služby):
       - overview: Vytvoř stručný základní přehled o firmě/osobě (1-2 věty).
       - rating: Ohodnoť na škále 1-10, jak moc je to vhodný kandidát na oslovení (10 = perfektní shoda).
       - icebreaker: Vytvoř velmi stručný, heslovitý tip na icebreaker (max 1-2 krátké body). TENTO TIP VYTVOŘ POUZE POKUD JE RATING VĚTŠÍ NEŽ 6! Pokud je rating 6 nebo menší, vrať null.

    VÝSTUP JSON:
    {
      "email": "nalezený email nebo null",
      "personName": "Celé Jméno nebo null",
      "firstName": "Křestní nebo null",
      "lastName": "Příjmení nebo null",
      "personRole": "Role (např. Jednatel) nebo null",
      "salutation": "Vážený pane Nováku / Dobrý den",
      "companyContext": "Stručný popis činnosti firmy (max 1 věta)",
      "ico": "IČO nebo null",
      "contactType": "person" | "generic" | "none",
      "language": "cs",
      "overview": "Základní přehled o firmě nebo null",
      "icebreaker": "Tip na icebreaker zprávu nebo null",
      "rating": 8
    }
  `;

  const ai = getAiClient();

  const callModel = async (modelName: string) => {
      return ai.models.generateContent({
        model: modelName,
        contents: combinedPrompt,
        config: {
          tools: [{ googleSearch: {} }],
        }
      });
  };

  let response: GenerateContentResponse;
  
  try {
      // Primary attempt
      response = await retryWithBackoff(() => callModel(PRIMARY_MODEL), 2, 5000);
  } catch (err) {
      console.warn(`Primary model (${PRIMARY_MODEL}) failed, switching to fallback (${FALLBACK_MODEL}).`);
      try {
        await sleep(3000); // Krátká pauza před přepnutím modelu
        response = await retryWithBackoff(() => callModel(FALLBACK_MODEL), 3, 10000);
      } catch (fallbackErr: any) {
        // Propagate specific overload errors so App.tsx can handle global pause
        throw fallbackErr;
      }
  }

  // Process Response
  try {
      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const groundingSources = groundingChunks
        .map(chunk => chunk.web ? { uri: chunk.web.uri, title: chunk.web.title } : null)
        .filter(Boolean) as { uri: string; title?: string }[];

      const rawText = response.text || "{}";
      const cleanedText = cleanJson(rawText);
      const data = JSON.parse(cleanedText);

      // Validate contact type logic fallback
      let type: ContactType = data.contactType;
      if (!type) {
          if (data.email && data.personName) type = 'person';
          else if (data.email) type = 'generic';
          else type = 'none';
      }

      return {
        email: data.email,
        personName: data.personName,
        firstName: data.firstName,
        lastName: data.lastName,
        personRole: data.personRole,
        salutation: data.salutation,
        companyContext: data.companyContext,
        ico: data.ico,
        language: data.language || 'cs',
        contactType: type,
        overview: data.overview,
        icebreaker: data.icebreaker,
        rating: data.rating,
        groundingSources
      };
  } catch (parseError) {
      console.error("JSON Parse Error", response.text);
      return {
           email: null,
           personName: null,
           firstName: null,
           lastName: null,
           personRole: null,
           salutation: null,
           companyContext: "Chyba čtení dat",
           ico: null,
           language: 'cs',
           contactType: 'none',
           overview: undefined,
           icebreaker: undefined,
           rating: undefined,
           groundingSources: []
      };
  }
};
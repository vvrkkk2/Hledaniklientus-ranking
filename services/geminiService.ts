import { EnrichedData, Segment, ContactType } from "../types";

// Modely
const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-flash"; 

const cleanJson = (text: string): string => {
    if (!text) return "{}";
    let clean = text.trim();
    if (clean.startsWith('```json')) clean = clean.substring(7);
    else if (clean.startsWith('```')) clean = clean.substring(3);
    if (clean.endsWith('```')) clean = clean.substring(0, clean.length - 3);
    clean = clean.trim();
    
    // Try to find array or object boundaries if there's still garbage
    const firstBracket = clean.indexOf('[');
    const lastBracket = clean.lastIndexOf(']');
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket && 
        (firstBrace === -1 || firstBracket < firstBrace)) {
        return clean.substring(firstBracket, lastBracket + 1);
    }
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return clean.substring(firstBrace, lastBrace + 1);
    }
    
    return clean;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const retryWithBackoff = async <T>(
  operation: () => Promise<T>, 
  retries = 3, 
  baseDelay = 2000 
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

const callApi = async (prompt: string, model: string, responseMimeType: string = 'text/plain', useSearch: boolean = false) => {
    const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model, responseMimeType, useSearch })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP error! status: ${res.status}`);
    }
    return await res.json();
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
    const response = await retryWithBackoff(() => callApi(prompt, PRIMARY_MODEL, 'application/json'), 2, 2000);
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
  serviceDescription?: string,
  searchEmails: boolean = true
): Promise<EnrichedData> => {
  
  const contextData = originalRow ? JSON.stringify(originalRow) : "";

  const combinedPrompt = `
    ÚKOL: ${searchEmails ? 'Najdi kontaktní údaje a analyzuj' : 'Analyzuj'} firmu.
    
    Máš k dispozici DVA hlavní zdroje informací:
    1. Webová stránka: ${url}
    2. Data z CSV tabulky (ZDE JSOU DALŠÍ DŮLEŽITÁ DATA OD UŽIVATELE!): ${contextData}
    
    Segment: ${segment.name}
    ${idealClientProfile ? `Požadavek na ideálního klienta: ${idealClientProfile}` : ''}
    ${serviceDescription ? `Popis naší služby: ${serviceDescription}` : ''}

    INSTRUKCE PRO ANALÝZU A HLEDÁNÍ:
    1. NEJDŘÍVE SI PROSTUDUJ DATA Z CSV! Obsahují důležitý kontext (např. poznámky, jména, obrat, historii), který musíš aktivně využít při hodnocení a tvorbě icebreakeru.
    2. Použij Google Search Grounding k prozkoumání webové stránky ${url} a doplň chybějící informace.
    3. Propoj informace z webu s daty z CSV. Pokud CSV obsahuje specifické detaily, odkaž na ně v icebreakeru nebo je zohledni v hodnocení.
    ${searchEmails ? `4. Hledej sekce "Kontakty", "O nás", "Tým", "Vedení společnosti".
    5. Hledej JMENOVITÉ emaily (např. jmeno.prijmeni@firma.cz). Toto je priorita.
    6. Pokud nenajdeš osobu, hledej obecný email (info@, kontakt@).` : `4. NEHLEDEJ konkrétní kontakty ani e-maily, soustřeď se pouze na celkovou analýzu.`}

    INSTRUKCE PRO ZPRACOVÁNÍ DAT:
    ${searchEmails ? `1. Pokud najdeš osobu, ROZDĚL jméno na:
       - firstName (Křestní jméno)
       - lastName (Příjmení - bez titulů)
    2. VYTVOŘ OSLOVENÍ (salutation):
       - Pokud máš jméno, vytvoř formální české oslovení v 5. pádě (vokativ).
       - Příklady: Jan Novák -> "Vážený pane Nováku", Marie Svobodová -> "Vážená paní Svobodová".
       - Pokud jméno nemáš, použij: "Dobrý den".

    3. KLASIFIKACE (contactType):
       - "person": Máš jméno osoby a email (osobní nebo malá firma).
       - "generic": Máš jen obecný email (info@).
       - "none": Nemáš email.` : `1. Pro pole email, personName, firstName, lastName, personRole, salutation vrať null.
    2. contactType nastav na "none".`}

    4. ANALÝZA LEADU (pokud je zadán profil ideálního klienta a popis služby):
       - overview: Vytvoř detailní přehled o firmě/osobě. Zahrň konkrétní informace: co přesně dělají, kde sídlí (lokalita), jaké mají zkušenosti/historii a jejich hlavní zaměření. Vyhni se obecným frázím, buď co nejvíce konkrétní (3-4 věty).
       - rating: Ohodnoť na škále 1-10, jak moc je to vhodný kandidát na oslovení. BUĎ VELMI PŘÍSNÝ A KRITICKÝ! 10 = naprosto dokonalá shoda s profilem ideálního klienta. Běžné firmy hodnoť níže (např. 3-6). Vyšší skóre dej jen těm, kteří mají zjevnou a silnou potřebu naší služby.
       - icebreaker: NEPIŠ PŘÍMÝ TEXT ZPRÁVY! Místo toho vytvoř seznam 2-3 zajímavých bodů (odrážek) pro obchodníka, které dodají "human touch". Jdi do hloubky: zmiň jejich konkrétní úspěchy, zajímavé klienty, unikátní vlastnosti jejich produktu/služby, nebo specifika jejich lokality. Najdi něco, co je pro ně naprosto unikátní. TENTO TIP VYTVOŘ POUZE POKUD JE RATING VĚTŠÍ NEŽ 6! Pokud je rating 6 nebo menší, vrať null.
       - location: Zjisti fyzické sídlo firmy nebo lokaci působení (Město, Stát). Vrať jako jeden string (např. "Praha, Česká republika" nebo "Berlín, Německo"). Pokud nenajdeš, vrať null.

    VÝSTUP JSON:
    {
      "email": ${searchEmails ? '"nalezený email nebo null"' : 'null'},
      "personName": ${searchEmails ? '"Celé Jméno nebo null"' : 'null'},
      "firstName": ${searchEmails ? '"Křestní nebo null"' : 'null'},
      "lastName": ${searchEmails ? '"Příjmení nebo null"' : 'null'},
      "personRole": ${searchEmails ? '"Role (např. Jednatel) nebo null"' : 'null'},
      "salutation": ${searchEmails ? '"Vážený pane Nováku / Dobrý den"' : 'null'},
      "companyContext": "Stručný popis činnosti firmy (max 1 věta)",
      "ico": "IČO nebo null",
      "contactType": ${searchEmails ? '"person" | "generic" | "none"' : '"none"'},
      "language": "cs",
      "overview": "Detailní přehled (co dělají, sídlo, zkušenosti) nebo null",
      "icebreaker": "Odrážky s unikátními body pro human touch nebo null",
      "rating": 8,
      "location": "Město, Stát nebo null"
    }
  `;

  const callModel = async (modelName: string) => {
      return callApi(combinedPrompt, modelName, 'application/json', true);
  };

  let response: any;
  
  try {
      // Primary attempt
      response = await retryWithBackoff(() => callModel(PRIMARY_MODEL), 2, 5000);
  } catch (err) {
      console.warn(`Primary model (${PRIMARY_MODEL}) failed, switching to fallback (${FALLBACK_MODEL}).`);
      try {
        await sleep(1000); // Krátká pauza před přepnutím modelu
        response = await retryWithBackoff(() => callModel(FALLBACK_MODEL), 3, 3000);
      } catch (fallbackErr: any) {
        // Propagate specific overload errors so App.tsx can handle global pause
        throw fallbackErr;
      }
  }

  // Process Response
  try {
      const groundingChunks = response.groundingMetadata?.groundingChunks || [];
      const groundingSources = groundingChunks
        .map((chunk: any) => chunk.web ? { uri: chunk.web.uri, title: chunk.web.title } : null)
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
        location: data.location,
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
           location: null,
           groundingSources: []
      };
  }
};
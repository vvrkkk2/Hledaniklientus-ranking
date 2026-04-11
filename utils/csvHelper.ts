/**
 * Simple robust CSV parser handling quotes and commas/semicolons
 */

const detectDelimiter = (line: string): string => {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (char === ',') commas++;
      else if (char === ';') semicolons++;
    }
  }
  
  return semicolons > commas ? ';' : ',';
};

export const parseCSV = (text: string): Record<string, string>[] => {
  const lines: string[] = [];
  let currentLine = '';
  let inQuotes = false;

  // Split logic handling newlines inside quotes
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (currentLine.trim()) lines.push(currentLine);
      currentLine = '';
      if (char === '\r' && text[i + 1] === '\n') i++; // skip \n after \r
    } else {
      currentLine += char;
    }
  }
  if (currentLine.trim()) lines.push(currentLine);

  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines[0]);

  // Parse Headers
  const headers = parseLine(lines[0], delimiter).map(h => h.trim());

  // Parse Rows
  const result: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i], delimiter);
    const row: Record<string, string> = {};
    
    // Map values to headers
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    result.push(row);
  }

  return result;
};

const parseLine = (line: string, delimiter: string = ','): string[] => {
  const result: string[] = [];
  let currentVal = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Double quote escaping inside quotes
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(currentVal.trim());
      currentVal = '';
    } else {
      currentVal += char;
    }
  }
  result.push(currentVal.trim());
  return result;
};

/**
 * Identify which column likely contains the URL
 */
export const findUrlColumn = (row: Record<string, string>): string | null => {
  const urlRegex = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
  
  // 1. Priority: Check headers strictly
  const keys = Object.keys(row);
  const strictHeader = keys.find(k => ['url', 'web', 'website', 'stránka', 'webová stránka'].includes(k.toLowerCase()));
  if (strictHeader) return strictHeader;

  // 2. Scan values for URL-like patterns
  for (const [key, value] of Object.entries(row)) {
    if (urlRegex.test(value) && value.length > 5) {
      return key;
    }
  }

  return null;
};

import { LiturgyData } from '../types';
import { logger } from './logger';

const VERCEL_API_BASE = "https://api-liturgia-diaria.vercel.app";

// Helper to clean bible text (remove verse numbers like '1 ' or '12 ')
export function cleanGospelText(text: string): string {
  if (!text) return "";
  logger.info('Cleaning gospel text...');
  // Removes line breaks and extra spaces
  let clean = text.replace(/[\r\n]+/g, ' ').trim();
  
  // 1. Remove numbers followed immediately by letters (e.g. "12Jesus")
  // Matches "12" in "12Jesus"
  clean = clean.replace(/\b\d{1,3}(?=[A-Za-zÁ-Úá-ú])/g, "");
  
  // 2. Remove standalone numbers followed by space AND a letter/quote (e.g. "5 quando", "6 'Senhor")
  // This catches the specific issue reported (e.g. "Naquele tempo, 5 quando")
  clean = clean.replace(/\b\d{1,3}\s+(?=["'A-Za-zÁ-Úá-ú])/g, "");

  // 3. Remove standalone numbers followed by a dot (e.g. "1. Naquele")
  clean = clean.replace(/\b\d{1,3}\.\s+/g, "");

  // Fix double spaces created by removal
  clean = clean.replace(/\s{2,}/g, " ");
  
  logger.info('Gospel text cleaned successfully.');
  return clean.trim();
}

export function formatLiturgicalReading(text: string, reference: string): string {
  if (!text) return "";
  logger.info('Formatting liturgical reading...', { reference });
  
  // 1. Clean the body text first to remove verse numbers
  const cleanBody = cleanGospelText(text);

  // 2. Try to parse reference e.g., "Mt 5, 1-12" or "Mateus 5, 1-12"
  // Regex matches: Name (Group 1), Chapter (Group 2), Verses (Group 3)
  const refRegex = /^([1-3]?\s?[A-Za-zÁ-Úá-ú.]+)\s+(\d{1,3})\s*[,:]\s*([0-9\-\s,]+)/;
  const match = reference.trim().match(refRegex);

  let abertura = "";
  
  if (match) {
    let evangelista = match[1].trim();
    const capitulo = match[2].trim();
    let versiculos = match[3].trim().replace(/-|–/g, " a ");
    
    // Map abbreviations to full names
    const bibleMap: {[key: string]: string} = {
      "Mt": "Mateus", "Mc": "Marcos", "Lc": "Lucas", "Jo": "João",
      "Gen": "Gênesis", "Ex": "Êxodo", "Lv": "Levítico", "Nm": "Números", "Dt": "Deuteronômio",
      "Sl": "Salmos", "Is": "Isaías", "Jr": "Jeremias", "Ez": "Ezequiel", "Dn": "Daniel",
      "Os": "Oséias", "Jl": "Joel", "Am": "Amós", "Ob": "Abdias", "Jn": "Jonas", "Mq": "Miquéias",
      "Na": "Naum", "Hc": "Habacuque", "Sf": "Sofonias", "Ag": "Ageu", "Zc": "Zacarias", "Ml": "Malaquias",
      "Rm": "Romanos", "1 Cor": "Primeira Coríntios", "2 Cor": "Segunda Coríntios", "Gl": "Gálatas",
      "Ef": "Efésios", "Fp": "Filipenses", "Cl": "Colossenses", "1 Ts": "Primeira Tessalonicenses",
      "2 Ts": "Segunda Tessalonicenses", "1 Tm": "Primeira Timóteo", "2 Tm": "Segunda Timóteo",
      "Tt": "Tito", "Fm": "Filemom", "Hb": "Hebreus", "Tg": "Tiago", "1 Pe": "Primeira Pedro",
      "2 Pe": "Segunda Pedro", "1 Jo": "Primeira João", "2 Jo": "Segunda João", "3 Jo": "Terceira João",
      "Jd": "Judas", "Ap": "Apocalipse",
      "1Rs": "Primeiro Reis", "2Rs": "Segundo Reis", // Added for common readings
      "At": "Atos dos Apóstolos" // Added for common readings
    };

    // Normalize comparison
    const normalizedEvangelista = evangelista.replace(/\./g, ''); // Remove dots for matching (e.g., "1Jo." -> "1Jo")
    if (bibleMap[normalizedEvangelista]) {
        evangelista = bibleMap[normalizedEvangelista];
    } else if (bibleMap[evangelista]) { // Fallback to original if normalized fails
         evangelista = bibleMap[evangelista];
    }


    // Add "São" prefix if missing and it's a standard Gospel
    const isGospel = ["Mateus", "Marcos", "Lucas", "João"].some(n => evangelista.includes(n));
    const prefix = isGospel && !evangelista.startsWith("São") && !evangelista.startsWith("Santo") ? "São " : "";

    abertura = `Proclamação do Evangelho de Jesus Cristo, segundo ${prefix}${evangelista}, Capítulo ${capitulo}, versículos ${versiculos}. Glória a vós, Senhor!`;
    logger.info('Liturgical opening formulated.', { abertura });
  } else {
    // Fallback generic intro
    abertura = `Proclamação do Evangelho de Jesus Cristo. Glória a vós, Senhor!`;
    logger.warn('Could not parse specific reference, using generic liturgical opening.');
  }

  const fechamento = "Palavra da Salvação. Glória a vós, Senhor!";
  const formattedText = `${abertura} ${cleanBody} ${fechamento}`;
  logger.info('Liturgical reading formatted.', { length: formattedText.length });
  return formattedText;
}

export async function fetchLiturgyFromApi(dateStr: string): Promise<LiturgyData> {
  logger.info(`Attempting to fetch liturgy from Vercel API for date: ${dateStr}`);
  try {
    // Matches Python script logic: uses query param instead of path params
    // Endpoint: /?date=YYYY-MM-DD
    const url = `${VERCEL_API_BASE}/?date=${dateStr}`;

    const response = await fetch(url);

    if (!response.ok) {
      logger.error('Vercel API returned an error', new Error(`HTTP ${response.status}`), { url });
      throw new Error(`Vercel API Error: ${response.status}`);
    }

    const json = await response.json();
    
    // The Python script relies on structure: json.today.readings.gospel
    // We navigate safely
    const today = json.today || {};
    const readings = today.readings || {};
    const gospel = readings.gospel || {};
    const firstReading = readings.first_reading || {};
    const secondReading = readings.second_reading || {};
    const psalm = readings.psalm || {};

    const tituloLiturgico = today.entry_title || "Liturgia Diária";

    const mappedData: LiturgyData = {
      evangelho: gospel.referencia || gospel.title || "Evangelho do Dia",
      texto_evangelho: cleanGospelText(gospel.text),
      
      primeira_leitura: firstReading.referencia || firstReading.title || "",
      texto_primeira_leitura: cleanGospelText(firstReading.text),
      
      segunda_leitura: secondReading.referencia || secondReading.title || "",
      texto_segunda_leitura: cleanGospelText(secondReading.text),
      
      salmo: psalm.referencia || psalm.title || "",
      texto_salmo: cleanGospelText(psalm.text),
      
      referencia_liturgica: tituloLiturgico
    };
    logger.info('Successfully fetched liturgy from Vercel API.', mappedData);
    return mappedData;

  } catch (error) {
    logger.warn("Primary API Fetch Failed:", error);
    throw error;
  }
}
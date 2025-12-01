import { JobPayload, Roteiro } from '../types';
import { logger } from './logger';

// ATENÇÃO: Esta URL foi atualizada com a nova URL fornecida pelo usuário.
// Certifique-se de que esta é a URL EXATA da sua implantação MAIS RECENTE do Google Apps Script.
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbx5DZ52ohxKPl6Lh0DnkhHJejuPBx1Ud6B10Ag_xfnJVzGpE83n7gHdUHnk4yAgrpuidw/exec";

// Note: fetchLiturgy has been moved to liturgyService.ts (Direct API) and geminiService.ts (Fallback)

export async function sendJobToGAS(payload: JobPayload): Promise<string> {
  logger.info('Attempting to send job to Google Apps Script...', { action: 'generate_job', date: payload.meta_dados.data });
  try {
    // Using 'text/plain' avoids the CORS preflight (OPTIONS) request which GAS often fails to handle.
    // The GAS backend (doPost) will still receive the body as a string and can parse it with JSON.parse().
    const response = await fetch(`${GAS_API_URL}?action=generate_job`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        logger.error('GAS Network Error', new Error(`HTTP ${response.status} - ${errorText}`));
        throw new Error(`GAS Network Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data.status === 'success') {
      logger.info(`Job sent successfully. Job ID: ${data.job_id}`);
      return data.job_id;
    } else {
      logger.error('Error from GAS backend', data.message || "Unknown error", data);
      throw new Error(data.message || "Unknown error from GAS backend.");
    }
  } catch (error: any) {
    logger.error("Upload Job Error", error);
    if (error.message === "Failed to fetch") {
        throw new Error("Connection to Google Apps Script failed. This is likely a CORS issue, incorrect GAS URL, or the payload is too large.");
    }
    throw error;
  }
}

export async function sendTestJob(): Promise<string> {
  // Create a minimal valid payload to validate connection without heavy generation
  const dummyRoteiroBlock = { text: "Test", prompt: "Test" };
  const testPayload: JobPayload = {
      assets: [{
          block_id: "test_connection_file",
          type: "srt", // Using SRT as it is text-based and small
          data_b64: btoa("Connection Test Successful. If you see this file in Drive, the pipeline works.")
      }],
      roteiro: {
          hook: dummyRoteiroBlock,
          leitura: dummyRoteiroBlock,
          reflexao: dummyRoteiroBlock,
          aplicacao: dummyRoteiroBlock,
          oracao: dummyRoteiroBlock,
      },
      meta_dados: {
          data: new Date().toISOString().split('T')[0],
          ref: "SYSTEM_CONNECTION_TEST"
      },
      leitura_montada: "System Connection Test"
  };
  logger.info('Attempting to send test job to Google Apps Script.');
  return sendJobToGAS(testPayload);
}
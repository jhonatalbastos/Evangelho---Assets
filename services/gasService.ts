import { JobPayload } from '../types';
import { logger } from './logger';

// URL DO SEU SCRIPT (Mantenha a sua URL atual se for a mesma)
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbx5DZ52ohxKPl6Lh0DnkhHJejuPBx1Ud6B10Ag_xfnJVzGpE83n7gHdUHnk4yAgrpuidw/exec";

export interface DriveJob {
  id: string;
  filename: string;
  updated: string; // timestamp number que o JSON do GAS manda, mas aqui tratamos como string/number
  display_date?: string; // Novo campo
  display_ref?: string;  // Novo campo
}

export async function listJobs(): Promise<DriveJob[]> {
  logger.info('Fetching job list from GAS...');
  try {
    const response = await fetch(`${GAS_API_URL}?action=list_jobs`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.status === 'success') {
      return data.jobs;
    }
    throw new Error(data.message || 'Failed to list jobs');
  } catch (error) {
    logger.error("List Jobs Error", error);
    return [];
  }
}

export async function fetchJob(jobId: string): Promise<JobPayload | null> {
  logger.info(`Fetching job details: ${jobId}`);
  try {
    const response = await fetch(`${GAS_API_URL}?action=get_job&job_id=${jobId}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data as JobPayload;
  } catch (error) {
    logger.error("Fetch Job Error", error);
    return null;
  }
}

export async function sendJobToGAS(payload: JobPayload, existingJobId?: string): Promise<string> {
  const finalPayload = existingJobId ? { ...payload, job_id: existingJobId } : payload;
  logger.info('Sending job to GAS...', { ref: payload.meta_dados.ref });

  try {
    const response = await fetch(`${GAS_API_URL}?action=generate_job`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(finalPayload)
    });

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`GAS Error: ${txt}`);
    }

    const data = await response.json();
    if (data.status === 'success') return data.job_id;
    else throw new Error(data.message);
  } catch (error: any) {
    logger.error("Upload Job Error", error);
    throw error;
  }
}
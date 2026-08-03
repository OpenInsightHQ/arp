const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { getCodeBaseURL } = require('@librechat/agents');
const { createAxiosInstance, logAxiosError } = require('@librechat/api');
const { isPIConfigured, uploadFile: uploadFileToPI } = require('~/server/services/PIService');

const axios = createAxiosInstance();

const MAX_FILE_SIZE = 150 * 1024 * 1024;

/**
 * Retrieves a download stream for a specified file.
 * @param {string} fileIdentifier - The identifier for the file (e.g., "session_id/fileId").
 * @param {string} apiKey - The API key for authentication.
 * @returns {Promise<AxiosResponse>} A promise that resolves to a readable stream of the file content.
 * @throws {Error} If there's an error during the download process.
 */
async function getCodeOutputDownloadStream(fileIdentifier, apiKey) {
  try {
    const baseURL = getCodeBaseURL();
    /** @type {import('axios').AxiosRequestConfig} */
    const options = {
      method: 'get',
      url: `${baseURL}/download/${fileIdentifier}`,
      responseType: 'stream',
      headers: {
        'User-Agent': 'LibreChat/1.0',
        'X-API-Key': apiKey,
      },
      timeout: 15000,
    };

    const response = await axios(options);
    return response;
  } catch (error) {
    throw new Error(
      logAxiosError({
        message: `Error downloading code environment file stream: ${error.message}`,
        error,
      }),
    );
  }
}

/**
 * Uploads a file to the Code Environment server or PI.
 * @param {Object} params - The params object.
 * @param {ServerRequest} params.req - The request object from Express. It should have a `user` property with an `id` representing the user
 * @param {import('fs').ReadStream | import('stream').Readable} params.stream - The read stream for the file.
 * @param {string} params.filename - The name of the file.
 * @param {string} params.apiKey - The API key for authentication.
 * @param {string} [params.entity_id] - Optional entity ID for the file.
 * @param {string} [params.sessionId] - Optional session ID for PI upload.
 * @param {string} [params.path] - Optional relative path for PI upload.
 * @returns {Promise<string>}
 * @throws {Error} If there's an error during the upload process.
 */
async function uploadCodeEnvFile({
  req,
  stream,
  filename,
  apiKey,
  entity_id = '',
  sessionId,
  path: uploadPath,
  bypassPI = false,
}) {
  if (isPIConfigured(req) && !bypassPI) {
    return uploadToPI({ req, stream, filename, entity_id, sessionId, path: uploadPath });
  }

  try {
    const form = new FormData();
    if (entity_id.length > 0) {
      form.append('entity_id', entity_id);
    }
    form.append('file', stream, filename);

    const baseURL = getCodeBaseURL();
    /** @type {import('axios').AxiosRequestConfig} */
    const options = {
      headers: {
        ...form.getHeaders(),
        'User-Agent': 'LibreChat/1.0',
        'User-Id': req.user.id,
        'X-API-Key': apiKey,
      },
      maxContentLength: MAX_FILE_SIZE,
      maxBodyLength: MAX_FILE_SIZE,
    };

    const response = await axios.post(`${baseURL}/upload`, form, options);

    /** @type {{ message: string; session_id: string; files: Array<{ fileId: string; filename: string }> }} */
    const result = response.data;
    if (result.message !== 'success') {
      throw new Error(`Error uploading file: ${result.message}`);
    }

    const fileIdentifier = `${result.session_id}/${result.files[0].fileId}`;
    if (entity_id.length === 0) {
      return fileIdentifier;
    }

    return `${fileIdentifier}?entity_id=${entity_id}`;
  } catch (error) {
    throw new Error(
      logAxiosError({
        message: `Error uploading code environment file: ${error.message}`,
        error,
      }),
    );
  }
}

/**
 * Uploads a file to PI server.
 * @param {Object} params - The params object.
 * @param {ServerRequest} params.req - The request object from Express.
 * @param {import('fs').ReadStream | import('stream').Readable} params.stream - The read stream for the file.
 * @param {string} params.filename - The name of the file.
 * @param {string} [params.entity_id] - Optional entity ID (agentId).
 * @param {string} [params.sessionId] - Optional session ID.
 * @param {string} [params.path] - Optional relative path in working directory.
 * @returns {Promise<string>}
 */
async function uploadToPI({ req, stream, filename, entity_id = '', sessionId, path: uploadPath }) {
  const { logger } = require('@librechat/data-schemas');
  const os = require('os');
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `upload-${Date.now()}-${filename}`);

  try {
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(tempFilePath);
      stream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const effectiveSessionId = sessionId || req.body?.sessionId;
    const effectiveAgentId = entity_id || 'default';

    if (!effectiveAgentId || effectiveAgentId === 'default') {
      throw new Error('Invalid agentId for PI upload. agentId is required.');
    }

    logger.debug(
      `[uploadToPI] sessionId: ${effectiveSessionId}, agentId: ${effectiveAgentId}, path: ${uploadPath || '(root)'}, filename: ${filename}`,
    );

    if (!effectiveSessionId) {
      throw new Error('sessionId is required for PI upload');
    }

    const result = await uploadFileToPI(
      {
        filePath: tempFilePath,
        sessionId: effectiveSessionId,
        agentId: effectiveAgentId,
        path: uploadPath,
        originalFilename: filename,
      },
      req.user.id,
    );

    if (!result.success) {
      throw new Error(result.error || 'Failed to upload file to PI');
    }

    const responseData = result.data;
    logger.debug(`[uploadToPI] PI response: ${JSON.stringify(responseData)}`);

    if (!responseData.success) {
      throw new Error(responseData.error || 'PI upload failed');
    }

    const fileIdentifier = `${effectiveSessionId}/${filename}`;

    if (!entity_id || entity_id.length === 0) {
      return fileIdentifier;
    }
    return `${fileIdentifier}?entity_id=${entity_id}`;
  } finally {
    fs.unlink(tempFilePath, () => {});
  }
}

module.exports = { getCodeOutputDownloadStream, uploadCodeEnvFile };

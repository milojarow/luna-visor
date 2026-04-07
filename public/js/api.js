const API = {
  async request(method, path, body) {
    const opts = { method, headers: {} };
    if (body && !(body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (body) {
      opts.body = body;
    }
    const res = await fetch(path, opts);
    if (res.status === 401) {
      window.location.href = '/login.html';
      return null;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  getClients() { return this.request('GET', '/api/clients'); },
  createClient(name) { return this.request('POST', '/api/clients', { name }); },
  renameClient(id, name) { return this.request('PATCH', `/api/clients/${id}`, { name }); },
  deleteClient(id) { return this.request('DELETE', `/api/clients/${id}`); },

  getFiles(clientId) {
    const qs = clientId ? `?client_id=${clientId}` : '';
    return this.request('GET', `/api/files${qs}`);
  },
  deleteFile(id) { return this.request('DELETE', `/api/files/${id}`); },
  moveFile(id, clientId) { return this.request('PATCH', `/api/files/${id}`, { client_id: clientId }); },
  copyFile(id, clientId) { return this.request('POST', `/api/files/${id}/copy`, { client_id: clientId }); },

  uploadFiles(files, clientId, onProgress) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('client_id', clientId);
      for (const f of files) formData.append('files', f);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/upload');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status === 201) resolve(JSON.parse(xhr.responseText));
        else reject(new Error(JSON.parse(xhr.responseText).error || 'Upload failed'));
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(formData);
    });
  },

  getApiKeys() { return this.request('GET', '/api/api-keys'); },
  createApiKey(name, clientId) { return this.request('POST', '/api/api-keys', { name, client_id: clientId }); },
  deleteApiKey(id) { return this.request('DELETE', `/api/api-keys/${id}`); },

  logout() { return this.request('POST', '/api/auth/logout'); },
};

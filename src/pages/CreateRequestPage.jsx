import React, { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';

import { api } from '../api/client.js';
import { requestTypes } from '../domain/constants.js';
import {
  emptyDetailsForType,
  requestDetailSchemas,
  validateDetails,
} from '../domain/requestDetails.js';

const initialForm = {
  type: 'job_referral',
  title: '',
  city: '',
  remote: false,
  expiresAt: '',
};

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxTradeImages = 6;
const maxImageBytes = 5 * 1024 * 1024;

function cleanDetailsForSubmit(type, details) {
  return Object.fromEntries([
    ...(requestDetailSchemas[type] ?? []).map((field) => [field.name, details[field.name]?.trim() ?? '']),
    ['extraNote', details.extraNote?.trim() ?? ''],
  ]);
}

export default function CreateRequestPage({ session }) {
  const [form, setForm] = useState(initialForm);
  const [details, setDetails] = useState(() => emptyDetailsForType(initialForm.type));
  const [images, setImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const mountedRef = useRef(false);
  const imagesRef = useRef([]);
  const submissionOwnerRef = useRef({ controller: null, version: 0 });
  const approved = session?.verificationStatus === 'approved';

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const owner = submissionOwnerRef.current;
      owner.version += 1;
      owner.controller?.abort();
      owner.controller = null;
      for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl);
    };
  }, []);

  function clearImages() {
    setImages((current) => {
      for (const image of current) URL.revokeObjectURL(image.previewUrl);
      return [];
    });
  }

  function update(event) {
    const { name, type, checked, value } = event.target;
    if (name === 'type') {
      setForm((current) => ({ ...current, type: value }));
      setDetails(emptyDetailsForType(value));
      clearImages();
      setFeedback(null);
      return;
    }
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
    setFeedback(null);
  }

  function updateDetail(event) {
    const { name, value } = event.target;
    setDetails((current) => ({ ...current, [name]: value }));
    setFeedback(null);
  }

  function updateImages(event) {
    const selected = [...event.target.files];
    event.target.value = '';
    if (images.length + selected.length > maxTradeImages) {
      setFeedback({ type: 'error', message: '买卖交易最多上传 6 张图片。' });
      return;
    }
    const invalid = selected.find((file) => (
      !allowedImageTypes.has(file.type) || file.size > maxImageBytes
    ));
    if (invalid) {
      setFeedback({ type: 'error', message: '图片需为 JPG/PNG/WebP，且单张不超过 5MB。' });
      return;
    }
    const nextImages = selected.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    setImages((current) => [...current, ...nextImages]);
    setFeedback(null);
  }

  function removeImage(indexToRemove) {
    setImages((current) => {
      const removed = current[indexToRemove];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((_image, index) => index !== indexToRemove);
    });
  }

  async function submit(event) {
    event.preventDefault();
    if (!approved) return;
    const owner = submissionOwnerRef.current;
    if (owner.controller) return;
    if (!requestTypes.some((type) => type.value === form.type)) {
      setFeedback({ type: 'error', message: '请选择委托类型。' });
      return;
    }
    if (!form.title.trim()) {
      setFeedback({ type: 'error', message: '请填写标题。' });
      return;
    }
    const detailsError = validateDetails(form.type, details);
    if (detailsError) {
      setFeedback({ type: 'error', message: detailsError });
      return;
    }
    if (!form.city.trim() && !form.remote) {
      setFeedback({ type: 'error', message: '请填写城市，或选择可远程。' });
      return;
    }
    const expiry = new Date(form.expiresAt);
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      setFeedback({ type: 'error', message: '请选择未来的有效期。' });
      return;
    }
    const payload = new FormData();
    const cleanDetails = cleanDetailsForSubmit(form.type, details);
    payload.append('type', form.type);
    payload.append('title', form.title.trim());
    payload.append('city', form.city.trim());
    payload.append('remote', String(form.remote));
    payload.append('expiresAt', expiry.toISOString());
    payload.append('details', JSON.stringify(cleanDetails));
    if (form.type === 'trade') {
      for (const image of images) payload.append('images', image.file);
    }

    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setSubmitting(true);
    try {
      await api('/api/requests', {
        method: 'POST',
        signal: controller.signal,
        body: payload,
      });
      if (!mountedRef.current || owner.version !== requestId) return;
      setFeedback({ type: 'success', message: '委托已送交掌柜审核。' });
      setForm(initialForm);
      setDetails(emptyDetailsForType(initialForm.type));
      clearImages();
    } catch (error) {
      if (!mountedRef.current || owner.version !== requestId || error.name === 'AbortError') return;
      setFeedback({ type: 'error', message: error.message || '暂时无法发布委托' });
    } finally {
      if (owner.version === requestId) {
        owner.controller = null;
        if (mountedRef.current) setSubmitting(false);
      }
    }
  }

  return (
    <section className="page create-request-page" aria-labelledby="create-title">
      <h2 id="create-title">发个委托</h2>
      <p className="page-intro">有事说清楚，合作才走得稳。</p>
      <p className="boundary-copy">万事屋不接账号交易、代练、外挂、私服相关委托，也不承诺求职或交易结果。</p>
      {!approved && <p role="status" className="attention-copy">请点击我的名片提交认证</p>}
      <form onSubmit={submit} noValidate>
        <label>类型<select name="type" value={form.type} onChange={update} required>{requestTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        <label>标题<input name="title" value={form.title} onChange={update} required maxLength={160} /></label>
        <div className="typed-fields">
          {(requestDetailSchemas[form.type] ?? []).map((field) => {
            const inputProps = {
              name: field.name,
              value: details[field.name] ?? '',
              onChange: updateDetail,
              maxLength: 800,
              required: field.required,
            };
            return (
              <label key={field.name}>
                {field.label}
                {field.multiline ? <textarea {...inputProps} /> : <input {...inputProps} />}
              </label>
            );
          })}
          <label>补充说明（选填）<textarea name="extraNote" value={details.extraNote ?? ''} onChange={updateDetail} maxLength={800} /></label>
        </div>
        {form.type === 'trade' && (
          <div className="image-upload-field">
            <label>
              买卖交易图片
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={updateImages} />
            </label>
            {images.length > 0 && (
              <div className="image-preview-grid">
                {images.map((image, index) => (
                  <figure key={`${image.file.name}-${index}`}>
                    <img src={image.previewUrl} alt={image.file.name} />
                    <button type="button" className="button-secondary" onClick={() => removeImage(index)} aria-label={`移除图片：${image.file.name}`}>移除</button>
                  </figure>
                ))}
              </div>
            )}
          </div>
        )}
        <label>城市<input name="city" value={form.city} onChange={update} maxLength={80} /></label>
        <label className="checkbox-field"><input name="remote" type="checkbox" checked={form.remote} onChange={update} />可远程</label>
        <label>有效期<input name="expiresAt" type="datetime-local" value={form.expiresAt} onChange={update} required /></label>
        <button type="submit" disabled={!approved || submitting} className="button-primary">
          <Send aria-hidden="true" size={18} />发布委托
        </button>
      </form>
      {feedback && <p role={feedback.type === 'success' ? 'status' : 'alert'}>{feedback.message}</p>}
    </section>
  );
}

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
  industry: '',
  budgetOrReward: '',
};

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxRequestImages = 6;
const maxImageBytes = 5 * 1024 * 1024;
const imageUploadHint = '支持 JPG/PNG/WebP，单张不超过 5MB，最多 6 张。';

function RequiredMark() {
  return <span className="required-mark" aria-hidden="true">*</span>;
}

function labelText(text, required = false) {
  return <span>{text}{required && <RequiredMark />}</span>;
}

function cleanDetailsForSubmit(type, details) {
  return Object.fromEntries([
    ...(requestDetailSchemas[type] ?? []).map((field) => [field.name, details[field.name]?.trim() ?? '']),
    ['extraNote', details.extraNote?.trim() ?? ''],
  ]);
}

function toDateTimeLocalValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function CreateRequestPage({ session, editRequestId, onEditComplete }) {
  const [form, setForm] = useState(initialForm);
  const [details, setDetails] = useState(() => emptyDetailsForType(initialForm.type));
  const [images, setImages] = useState([]);
  const [editLoading, setEditLoading] = useState(Boolean(editRequestId));
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const mountedRef = useRef(false);
  const imagesRef = useRef([]);
  const submissionOwnerRef = useRef({ controller: null, version: 0 });
  const editLoadOwnerRef = useRef({ controller: null, version: 0 });
  const approved = session?.verificationStatus === 'approved';
  const editing = Boolean(editRequestId);
  const hasExistingImages = editing && images.some((image) => image.existing);
  const imageFieldLabel = form.type === 'trade' ? '买卖交易图片' : '委托封面';

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
      for (const image of imagesRef.current) {
        if (!image.existing) URL.revokeObjectURL(image.previewUrl);
      }
      const editLoadOwner = editLoadOwnerRef.current;
      editLoadOwner.version += 1;
      editLoadOwner.controller?.abort();
      editLoadOwner.controller = null;
    };
  }, []);

  useEffect(() => {
    if (!editRequestId) {
      setEditLoading(false);
      setForm(initialForm);
      setDetails(emptyDetailsForType(initialForm.type));
      clearImages();
      return undefined;
    }
    const owner = editLoadOwnerRef.current;
    owner.controller?.abort();
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setEditLoading(true);
    setFeedback(null);

    async function loadRequest() {
      try {
        const result = await api(`/api/my/requests/${editRequestId}`, { signal: controller.signal });
        const request = result.request;
        if (!mountedRef.current || owner.version !== requestId || !request) return;
        setForm({
          type: request.type,
          title: request.title ?? '',
          city: request.city ?? '',
          remote: Boolean(request.remote),
          expiresAt: toDateTimeLocalValue(request.expiresAt),
          industry: request.industry ?? '',
          budgetOrReward: request.budgetOrReward ?? '',
        });
        setDetails({ ...emptyDetailsForType(request.type), ...(request.details ?? {}) });
        setImages((request.images ?? []).map((image, index) => ({
          existing: true,
          name: `原有图片 ${index + 1}`,
          previewUrl: image.url,
        })));
      } catch (error) {
        if (!mountedRef.current || owner.version !== requestId || error.name === 'AbortError') return;
        setFeedback({ type: 'error', message: error.message || '暂时无法加载委托' });
      } finally {
        if (owner.version === requestId) {
          owner.controller = null;
          if (mountedRef.current) setEditLoading(false);
        }
      }
    }
    loadRequest();
    return () => {
      owner.version += 1;
      owner.controller?.abort();
      owner.controller = null;
    };
  }, [editRequestId]);

  function clearImages() {
    setImages((current) => {
      for (const image of current) {
        if (!image.existing) URL.revokeObjectURL(image.previewUrl);
      }
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
    if (editing) return;
    const selected = [...event.target.files];
    event.target.value = '';
    if (images.length + selected.length > maxRequestImages) {
      setFeedback({ type: 'error', message: '图片最多上传 6 张。' });
      return;
    }
    const invalid = selected.find((file) => (
      !allowedImageTypes.has(file.type) || file.size > maxImageBytes
    ));
    if (invalid) {
      setFeedback({ type: 'error', message: '图片需为 JPG/PNG/WebP，且单张不超过 5MB。' });
      return;
    }
    const nextImages = selected.map((file) => ({ file, name: file.name, previewUrl: URL.createObjectURL(file) }));
    setImages((current) => [...current, ...nextImages]);
    setFeedback(null);
  }

  function removeImage(indexToRemove) {
    setImages((current) => {
      const removed = current[indexToRemove];
      if (removed && !removed.existing) URL.revokeObjectURL(removed.previewUrl);
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
    const cleanDetails = cleanDetailsForSubmit(form.type, details);
    const editPayload = {
      type: form.type,
      title: form.title.trim(),
      city: form.city.trim(),
      remote: form.remote,
      expiresAt: expiry.toISOString(),
      details: cleanDetails,
      industry: '',
      budgetOrReward: '',
    };
    const payload = new FormData();
    if (!editing) {
      payload.append('type', form.type);
      payload.append('title', form.title.trim());
      payload.append('city', form.city.trim());
      payload.append('remote', String(form.remote));
      payload.append('expiresAt', expiry.toISOString());
      payload.append('details', JSON.stringify(cleanDetails));
      payload.append('industry', '');
      payload.append('budgetOrReward', '');
      for (const image of images) payload.append('images', image.file);
    }

    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setSubmitting(true);
    try {
      await api(editing ? `/api/my/requests/${editRequestId}` : '/api/requests', {
        method: editing ? 'PUT' : 'POST',
        signal: controller.signal,
        body: editing ? editPayload : payload,
      });
      if (!mountedRef.current || owner.version !== requestId) return;
      if (editing) {
        onEditComplete?.(editRequestId);
        return;
      }
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
      <h2 id="create-title">{editing ? '修改委托' : '发个委托'}</h2>
      <p className="page-intro">有事说清楚，合作才走得稳。</p>
      <p className="boundary-copy">万事屋不接账号交易、代练、外挂、私服相关委托，也不承诺求职或交易结果。</p>
      {!approved && <p role="status" className="attention-copy">请点击我的名片提交认证</p>}
      <form onSubmit={submit} noValidate>
        <label>{labelText('类型', true)}<select aria-label="类型" name="type" value={form.type} onChange={update} required disabled={hasExistingImages}>{requestTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        <label>{labelText('标题', true)}<input aria-label="标题" name="title" value={form.title} onChange={update} required maxLength={160} /></label>
        <div className="typed-fields">
          {(requestDetailSchemas[form.type] ?? []).map((field) => {
            const inputProps = {
              name: field.name,
              value: details[field.name] ?? '',
              onChange: updateDetail,
              maxLength: 800,
              required: field.required,
              placeholder: field.placeholder,
              'aria-label': field.label,
            };
            return (
              <label key={field.name}>
                {labelText(field.label, field.required)}
                {field.multiline ? <textarea {...inputProps} /> : <input {...inputProps} />}
              </label>
            );
          })}
          <label>{labelText('补充说明（选填）')}<textarea aria-label="补充说明（选填）" name="extraNote" value={details.extraNote ?? ''} onChange={updateDetail} maxLength={800} /></label>
        </div>
        <div className="image-upload-field">
          {!editing && <label>
            {imageFieldLabel}
            <input aria-label={imageFieldLabel} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={updateImages} />
          </label>}
          <p className="field-hint">{imageUploadHint}</p>
          {images.length > 0 && (
            <div className="image-preview-grid">
              {images.map((image, index) => (
                <figure key={`${image.name}-${index}`}>
                  <img src={image.previewUrl} alt={image.name} />
                  {!editing && <button type="button" className="button-secondary" onClick={() => removeImage(index)} aria-label={`移除图片：${image.name}`}>移除</button>}
                </figure>
              ))}
            </div>
          )}
        </div>
        <div className="field-group">
          <p className="field-group-label">{labelText('城市/远程方式', true)}</p>
          <label>城市<input name="city" value={form.city} onChange={update} maxLength={80} /></label>
          <label className="checkbox-field"><input name="remote" type="checkbox" checked={form.remote} onChange={update} />可远程</label>
        </div>
        <label>{labelText('有效期', true)}<input aria-label="有效期" name="expiresAt" type="datetime-local" value={form.expiresAt} onChange={update} required /></label>
        <button type="submit" disabled={!approved || submitting || editLoading} className="button-primary">
          <Send aria-hidden="true" size={18} />{editing ? '重新提交审核' : '发布委托'}
        </button>
      </form>
      {feedback && <p role={feedback.type === 'success' ? 'status' : 'alert'}>{feedback.message}</p>}
    </section>
  );
}

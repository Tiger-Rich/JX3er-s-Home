import React, { useState } from 'react';
import { Send } from 'lucide-react';

import { api } from '../api/client.js';
import { requestTypes, verificationLabels } from '../domain/constants.js';

const initialForm = {
  type: 'job_referral', title: '', description: '', city: '', remote: false,
  industry: '', budgetOrReward: '', expiresAt: '',
};

export default function CreateRequestPage({ session }) {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const approved = session?.verificationStatus === 'approved';

  function update(event) {
    const { name, type, checked, value } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
    setFeedback('');
  }

  async function submit(event) {
    event.preventDefault();
    if (!approved) return;
    if (!requestTypes.some((type) => type.value === form.type)) {
      setFeedback('请选择委托类型。');
      return;
    }
    if (!form.title.trim()) {
      setFeedback('请填写标题。');
      return;
    }
    if (!form.description.trim()) {
      setFeedback('请填写委托说明。');
      return;
    }
    if (!form.city.trim() && !form.remote) {
      setFeedback('请填写城市，或选择可远程。');
      return;
    }
    const expiry = new Date(form.expiresAt);
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      setFeedback('请选择未来的有效期。');
      return;
    }
    setSubmitting(true);
    try {
      await api('/api/requests', {
        method: 'POST',
        body: {
          type: form.type,
          title: form.title.trim(),
          description: form.description.trim(),
          city: form.city.trim() || null,
          remote: form.remote,
          industry: form.industry.trim() || null,
          budgetOrReward: form.budgetOrReward.trim() || null,
          expiresAt: expiry.toISOString(),
        },
      });
      setFeedback('委托已送交掌柜审核。');
      setForm(initialForm);
    } catch (error) {
      setFeedback(error.message || '暂时无法发布委托');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page create-request-page" aria-labelledby="create-title">
      <h2 id="create-title">发个委托</h2>
      <p>有事说清楚，合作才走得稳。</p>
      <p className="boundary-copy">万事屋不接账号交易、代练、外挂、私服相关委托，也不承诺求职或交易结果。</p>
      {!approved && <p role="status">{verificationLabels[session?.verificationStatus] || '请先完成身份认证'}</p>}
      <form onSubmit={submit} noValidate>
        <label>类型<select name="type" value={form.type} onChange={update} required>{requestTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        <label>标题<input name="title" value={form.title} onChange={update} required maxLength={160} /></label>
        <label>委托说明<textarea name="description" value={form.description} onChange={update} required maxLength={4000} /></label>
        <label>城市<input name="city" value={form.city} onChange={update} maxLength={80} /></label>
        <label><input name="remote" type="checkbox" checked={form.remote} onChange={update} />可远程</label>
        <label>行业<input name="industry" value={form.industry} onChange={update} maxLength={120} /></label>
        <label>预算或回报<input name="budgetOrReward" value={form.budgetOrReward} onChange={update} maxLength={500} /></label>
        <label>有效期<input name="expiresAt" type="datetime-local" value={form.expiresAt} onChange={update} required /></label>
        <button type="submit" disabled={!approved || submitting}>
          <Send aria-hidden="true" size={18} />发布委托
        </button>
      </form>
      {feedback && <p role={feedback.includes('审核') ? 'status' : 'alert'}>{feedback}</p>}
    </section>
  );
}

import React from 'react';

import {
  applicationStatusLabels,
  requestStatusLabels,
  verificationLabels,
} from '../domain/constants.js';

const labelsByType = {
  application: applicationStatusLabels,
  request: requestStatusLabels,
  verification: verificationLabels,
};

export default function StatusBadge({ status, type = 'verification' }) {
  const label = labelsByType[type]?.[status] ?? '状态未知';

  return (
    <span className="status-badge" data-status={status}>
      {label}
    </span>
  );
}

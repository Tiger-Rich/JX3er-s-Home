export const myRequestFilters = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待评审' },
  { value: 'approved', label: '已发布' },
  { value: 'withdrawn', label: '已撤回' },
  { value: 'rejected', label: '未通过' },
  { value: 'closed', label: '已关闭' },
  { value: 'taken_down', label: '已下架' },
  { value: 'expired', label: '已过期' },
];

export function myRequestActions(request) {
  if (request.status === 'pending') return ['withdraw'];
  if (request.status === 'approved') return ['close'];
  if (request.status === 'closed') return ['hide'];
  return [];
}

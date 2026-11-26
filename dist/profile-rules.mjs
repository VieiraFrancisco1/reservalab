export function profileName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  return name.length >= 2 && name.length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(name) ? name : '';
}

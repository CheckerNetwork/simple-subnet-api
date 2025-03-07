export const getLocalDayAsISOString = (/** @type {Date} */ d) => {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-')
}

export const today = () => getLocalDayAsISOString(new Date())
export const yesterday = () => getLocalDayAsISOString(new Date(Date.now() - 24 * 60 * 60 * 1000))

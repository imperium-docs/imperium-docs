const getQuery = () => {
  const params = new URLSearchParams(window.location.search);
  const query: Record<string, string | string[]> = {};
  params.forEach((value, key) => {
    if (key in query) {
      const current = query[key];
      query[key] = Array.isArray(current) ? [...current, value] : [current, value];
    } else {
      query[key] = value;
    }
  });
  return query;
};

export const useRouter = () => {
  return {
    query: getQuery(),
    push: (href: string) => {
      window.location.href = href;
      return Promise.resolve(true);
    },
  };
};

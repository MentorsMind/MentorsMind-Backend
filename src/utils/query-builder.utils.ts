export const buildSearchQuery = (filters: any) => {
  const { skills, minPrice, maxPrice, minRating, language, sort, page = 1, limit = 10 } = filters;
  const offset = (page - 1) * limit;
  let query = `SELECT m.*, COUNT(*) OVER() as total_count FROM users m WHERE m.role = 'mentor'`;
  const values: any[] = [];

  if (skills && skills.length > 0) {
    values.push(skills);
    query += ` AND m.expertise && $${values.length}`;
  }

  if (minPrice) {
    values.push(minPrice);
    query += ` AND m.hourly_rate >= $${values.length}`;
  }

  if (maxPrice) {
    values.push(maxPrice);
    query += ` AND m.hourly_rate <= $${values.length}`;
  }

  if (minRating) {
    values.push(minRating);
    query += ` AND m.average_rating >= $${values.length}`;
  }

  if (language) {
    values.push(language);
    query += ` AND $${values.length} = ANY(m.expertise)`;
  }

  const sortMap: any = {
    rating: 'm.average_rating DESC',
    price: 'm.hourly_rate ASC',
    newest: 'm.created_at DESC',
  };
  query += ` ORDER BY ${sortMap[sort] || 'm.created_at DESC'}`;

  values.push(limit, offset);
  query += ` LIMIT $${values.length - 1} OFFSET $${values.length}`;

  return { query, values };
};

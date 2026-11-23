// Product Collector types, merged from the for_amina repository.

export type Product = {
  id: string;
  name: string;
  brand: string | null;
  price: string | null;
  priceValue: number | null;
  previousPrice: string | null;
  currency: string | null;
  description: string | null;
  image: string | null;
  thumbnail?: string | null;
  images: string[];
  url: string | null;
};

export type ScrapeResult = {
  source: string;
  title: string | null;
  total: number;
  count: number;
  products: Product[];
};

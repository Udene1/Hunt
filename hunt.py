import requests
from bs4 import BeautifulSoup
import pandas as pd
import time
import random
import argparse
import logging

class HuntScraper:
    def __init__(self, base_url):
        self.base_url = base_url
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        self.logger = logging.getLogger(__name__)

    def get_page_content(self, url):
        try:
            response = requests.get(url, headers=self.headers)
            response.raise_for_status()
            return BeautifulSoup(response.content, 'html.parser')
        except requests.RequestException as e:
            self.logger.error(f"Error fetching {url}: {e}")
            return None

    def extract_product_info(self, product_element):
        try:
            title = product_element.find('h2', class_='product-title').text.strip()
            price = product_element.find('span', class_='product-price').text.strip()
            rating = product_element.find('div', class_='product-rating').get('data-rating')
            return {
                'title': title,
                'price': price,
                'rating': rating
            }
        except AttributeError as e:
            self.logger.warning(f"Error extracting product info: {e}")
            return None

    def hunt_products(self, num_pages=5):
        all_products = []
        for page in range(1, num_pages + 1):
            url = f"{self.base_url}/products?page={page}"
            self.logger.info(f"Hunting on page {page}")
            soup = self.get_page_content(url)
            if soup is None:
                continue
            product_elements = soup.find_all('div', class_='product-item')
            
            for product in product_elements:
                product_info = self.extract_product_info(product)
                if product_info:
                    all_products.append(product_info)
            
            time.sleep(random.uniform(1, 3))
        
        return pd.DataFrame(all_products)

    def save_to_csv(self, df, filename='hunted_products.csv'):
        df.to_csv(filename, index=False)
        self.logger.info(f"Data saved to {filename}")

def main():
    parser = argparse.ArgumentParser(description="Hunt: Web scraper for product information")
    parser.add_argument("url", help="Base URL of the e-commerce site")
    parser.add_argument("-p", "--pages", type=int, default=5, help="Number of pages to hunt")
    parser.add_argument("-o", "--output", default="hunted_products.csv", help="Output CSV filename")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    scraper = HuntScraper(args.url)
    products_df = scraper.hunt_products(num_pages=args.pages)
    scraper.save_to_csv(products_df, filename=args.output)

if __name__ == "__main__":
    main()
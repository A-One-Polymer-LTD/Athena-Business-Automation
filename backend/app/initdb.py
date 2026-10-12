"""Create the tables and load the sample data:  python -m app.initdb  (uses DATABASE_URL)."""
from .main import init_db

if __name__ == "__main__":
    init_db()
    print("Database ready.")

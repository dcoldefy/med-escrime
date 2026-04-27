"""Script d'initialisation manuelle de la base de données."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database

if __name__ == "__main__":
    database.init_db()
    print("Base de données initialisée : db/med.db")

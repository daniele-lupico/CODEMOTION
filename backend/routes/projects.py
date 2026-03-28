from fastapi import APIRouter

router = APIRouter()


@router.get("/api/projects")
def list_projects():
    # Placeholder: in a full implementation projects group contracts by stakeholder.
    return {"projects": [{"id": "default", "name": "Portfolio Principale"}]}

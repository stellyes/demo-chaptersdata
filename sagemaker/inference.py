"""
SageMaker Inference Handler: Cannabis Compliance Classifier

Custom inference handler for the SageMaker Serverless Endpoint.
Receives serialized sales transaction text, returns multi-label
compliance risk predictions with confidence scores.

Input format (JSON):
    {"instances": ["Product Type: edible, Total Mg Thc: 150, ...", ...]}

Output format (JSON):
    {
        "predictions": [
            {
                "labels": ["thc_limit_violation"],
                "scores": {"compliant": 0.05, "thc_limit_violation": 0.92, ...},
                "risk_level": "high",
                "risk_score": 0.92
            },
            ...
        ]
    }
"""

import json
import logging
import os
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Globals populated by model_fn
_model = None
_tokenizer = None
_label_map = None
_device = None

THRESHOLD = 0.5
MAX_LENGTH = 256


def model_fn(model_dir: str):
    """Load the fine-tuned model, tokenizer, and label map."""
    global _model, _tokenizer, _label_map, _device

    logger.info(f"Loading model from {model_dir}")

    # Check if model is in a subdirectory
    model_path = model_dir
    if os.path.exists(os.path.join(model_dir, "model")):
        model_path = os.path.join(model_dir, "model")

    _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    _tokenizer = AutoTokenizer.from_pretrained(model_path)
    _model = AutoModelForSequenceClassification.from_pretrained(model_path)
    _model.to(_device)
    _model.eval()

    # Load label map
    label_map_path = os.path.join(model_path, "label_map.json")
    if os.path.exists(label_map_path):
        with open(label_map_path, "r") as f:
            _label_map = json.load(f)
    else:
        # Fallback to default labels
        _label_map = {
            "labels": [
                "compliant", "thc_limit_violation", "cbd_limit_violation",
                "missing_tracking", "age_verification_issue",
                "quantity_limit_violation", "tax_discrepancy",
                "naming_violation", "hours_violation",
                "pricing_anomaly", "distributor_issue",
            ]
        }

    logger.info(
        f"Model loaded: {_model.config.num_labels} labels, device={_device}"
    )

    return _model


def input_fn(request_body: str, content_type: str = "application/json"):
    """Parse input data from request body."""
    if content_type == "application/json":
        data = json.loads(request_body)
        if "instances" in data:
            return data["instances"]
        elif "text" in data:
            return [data["text"]]
        elif isinstance(data, list):
            return data
        else:
            raise ValueError(f"Unexpected JSON structure: {list(data.keys())}")
    else:
        raise ValueError(f"Unsupported content type: {content_type}")


def predict_fn(input_data: list, model):
    """Run inference on input texts."""
    global _tokenizer, _label_map, _device

    if not input_data:
        return {"predictions": []}

    # Tokenize
    encodings = _tokenizer(
        input_data,
        max_length=MAX_LENGTH,
        padding=True,
        truncation=True,
        return_tensors="pt",
    )
    encodings = {k: v.to(_device) for k, v in encodings.items()}

    # Inference
    with torch.no_grad():
        outputs = model(**encodings)
        logits = outputs.logits.cpu().numpy()

    # Apply sigmoid for multi-label probabilities
    probs = 1 / (1 + np.exp(-logits))

    labels = _label_map.get("labels", [])
    predictions = []

    for i in range(len(input_data)):
        scores = {}
        detected_labels = []
        max_violation_score = 0.0

        for j, label_name in enumerate(labels):
            if j < probs.shape[1]:
                score = float(probs[i][j])
                scores[label_name] = round(score, 4)

                if label_name != "compliant" and score >= THRESHOLD:
                    detected_labels.append(label_name)
                    max_violation_score = max(max_violation_score, score)

        # If no violations detected, mark as compliant
        if not detected_labels:
            detected_labels = ["compliant"]
            risk_score = 1.0 - scores.get("compliant", 0.5)
        else:
            risk_score = max_violation_score

        predictions.append({
            "labels": detected_labels,
            "scores": scores,
            "risk_level": score_to_risk_level(risk_score),
            "risk_score": round(risk_score, 4),
        })

    return {"predictions": predictions}


def output_fn(prediction_output: dict, accept: str = "application/json"):
    """Serialize prediction output."""
    return json.dumps(prediction_output)


def score_to_risk_level(score: float) -> str:
    """Map numeric risk score to risk level."""
    if score >= 0.9:
        return "critical"
    elif score >= 0.7:
        return "high"
    elif score >= 0.4:
        return "medium"
    return "low"

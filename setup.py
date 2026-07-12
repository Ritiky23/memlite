from setuptools import setup, find_packages

setup(
    name="memlite",
    version="0.1.0",
    description="MemLite — Local-first Memory Engine for AI Applications",
    long_description=open("README.md", "r", encoding="utf-8").read() if open("README.md", "r", encoding="utf-8") else "",
    long_description_content_type="text/markdown",
    author="Ritik",
    packages=find_packages(),
    install_requires=[
        "numpy>=1.20.0",
        "pydantic>=2.0",
    ],
    extras_require={
        "local": [
            "faiss-cpu>=1.7.0",
            "sentence-transformers>=2.2.0",
        ],
        "openai": [
            "openai>=1.0.0",
        ],
        "all": [
            "faiss-cpu>=1.7.0",
            "sentence-transformers>=2.2.0",
            "openai>=1.0.0",
        ]
    },
    python_requires=">=3.8",
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
)

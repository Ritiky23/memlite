from setuptools import setup, find_packages

setup(
    name="memlite",
    version="2.0.0",
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
        "fastembed": [
            "fastembed>=0.2.0",
        ],
        "openai": [
            "openai>=1.0.0",
        ],
        "all": [
            "faiss-cpu>=1.7.0",
            "sentence-transformers>=2.2.0",
            "fastembed>=0.2.0",
            "openai>=1.0.0",
        ]
    },
    entry_points={
        "console_scripts": [
            "memlite = memlite.cli:main",
        ]
    },
    python_requires=">=3.8",
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
)


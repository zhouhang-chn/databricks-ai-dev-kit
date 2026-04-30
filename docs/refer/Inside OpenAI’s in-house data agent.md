---
title: "Inside OpenAI’s in-house data agent"
source: "https://openai.com/index/inside-our-in-house-data-agent/"
author:
  - "[[Bonnie Xu]]"
  - "[[Aravind Suresh]]"
  - "[[and Emma Tang]]"
published: 2026-03-11
created: 2026-04-17
description: "How OpenAI built an in-house AI data agent that uses GPT-5, Codex, and memory to reason over massive datasets and deliver reliable insights in minutes."
tags:
  - "clippings"
---
<audio src="https://cdn-azalea-tts-achmg6dqbafjaxcr.a01.azurefd.net/tts-prod/7190AgeXzqz4mslt2KLtC2/ember/cf035d96a0f6bd6bdb74e09cb2deb53a.mp3"></audio>

Data powers how systems learn, products evolve, and how companies make choices. But getting answers quickly, correctly, and with the right context is often harder than it should be. To make this easier as OpenAI scales, we built **our own bespoke in-house AI data agent** that explores and reasons over our own platform**.**

Our agent is a custom internal-only tool (not an external offering), built specifically around OpenAI’s data, permissions, and workflows. We’re showing how we built and use it to help surface examples of the real, impactful ways AI can support day-to-day work across our teams. The OpenAI tools we used to build and run it ([Codex](https://openai.com/index/introducing-codex/), [our GPT‑5 flagship model](https://openai.com/index/introducing-gpt-5-2/), the [Evals API ⁠](https://platform.openai.com/docs/guides/evals), and the [Embeddings API ⁠](https://platform.openai.com/docs/guides/embeddings)) are the same tools we make available to developers everywhere.

Our data agentlets employees go from question to insight in minutes, not days. This lowers the bar to pulling data and nuanced analysis across all functions, not just by our data team. Today, teams across Engineering, Data Science, Go-To-Market, Finance, and Research at OpenAI lean on the agent to answer **high-impact data questions.** For example, it can help answer how to evaluate launches and understand business health, all through the intuitive format of natural language. The agent combines Codex-powered table-level knowledge with product and organizational context. Its continuously learning memory system means it also improves with every turn.

![Screenshot showing a user asking for ChatGPT WAU on Oct 6, 2025 compared with DevDay 2023. The agent reports ≈800M WAU for 2025 and ≈100M for 2023, with notes showing a +700M change and an ~8× increase, followed by explanatory context.](https://images.ctfassets.net/kftzwdyauwt9/1JpGRdxRkRn4vFSOFTNK2j/346a78cedb9fc338d732c72ed88adb62/Desktop-Dark.png?w=3840&q=80&fm=webp)

Screenshot showing a user asking for ChatGPT WAU on Oct 6, 2025 compared with DevDay 2023. The agent reports ≈800M WAU for 2025 and ≈100M for 2023, with notes showing a +700M change and an ~8× increase, followed by explanatory context.

In this post, we’ll break down why we needed a bespoke AI data agent, what makes its code-enriched data context and self-learning so useful, and lessons we learned along the way.

## Why we needed a custom tool

OpenAI’s data platform serves more than **3.5k internal users** working across Engineering, Product, and Research, spanning over **600 petabytes** of data across **70k datasets.** At that size, simply finding the right table can be one of the most time-consuming parts of doing analysis.

As one internal user put it:

*“We have a lot of tables that are fairly similar, and I spend tons of time trying to figure out how they’re different and which to use. Some include logged-out users, some don’t. Some have overlapping fields; it’s hard to tell what is what.”*

Even with the correct tables selected, producing correct results can be challenging. Analysts must reason about table data and table relationships to ensure transformations and filters are applied correctly. Common failure modes—many-to-many joins, filter pushdown errors, and unhandled nulls—can silently invalidate results. At OpenAI’s scale, analysts should not have to sink time into debugging SQL semantics or query performance: their focus should be on defining metrics, validating assumptions, and making data-driven decisions.

![Screenshot of SQL code defining two CTEs—order_enriched and monthly_segment—that join customer geography data, derive order-month fields, and compute monthly aggregates such as order counts, gross revenue, revenue with tax, and average ship-to-receipt days.](https://images.ctfassets.net/kftzwdyauwt9/5AgsmVnLabpc9aeVprgl9n/53c658c2ca42b90ed715045dc3365566/Desktop-Dark.png?w=3840&q=80&fm=webp)

This SQL statement is 180+ lines long. It’s not easy to know if we’re joining the right tables and querying the right columns.

## How it works

Let’s walk through what our agent is, how it curates context, and how it keeps self-improving.

Our agent is powered by [**GPT‑5.2**](https://openai.com/index/introducing-gpt-5-2/) and is designed to reason over OpenAI’s data platform. It’s available wherever employees already work: as a Slack agent, through a web interface, inside IDEs, in the [Codex CLI via MCP ⁠](https://developers.openai.com/codex/mcp/), and directly in [OpenAI’s internal ChatGPT app through a MCP connector ⁠](https://platform.openai.com/docs/guides/tools-connectors-mcp).

![Diagram titled “How the data agent works.” Entrypoints—Agent-UI, Local Agent-MCP, Remote Agent-MCP, and Slack Agent—feed into an Agent-API. The API connects to internal data knowledge and company context, syncs with a data warehouse and platform sources, and exchanges requests with the GPT-5.2 model via Agent-MCP.](https://images.ctfassets.net/kftzwdyauwt9/45tj3Vpk3ptc4kTOhUnfQk/a443d85b8a3ab8633206498e58282c54/oai_in-house_data_agent_How_it_works_desktop-dark.svg?w=3840&q=80)

Diagram titled “How the data agent works.” Entrypoints—Agent-UI, Local Agent-MCP, Remote Agent-MCP, and Slack Agent—feed into an Agent-API. The API connects to internal data knowledge and company context, syncs with a data warehouse and platform sources, and exchanges requests with the GPT-5.2 model via Agent-MCP.

Users can ask complex, open-ended questions which would typically require multiple rounds of manual exploration. Take this example prompt, which uses a test data set: *“For NYC taxi trips, which pickup-to-dropoff ZIP pairs are the most unreliable, with the largest gap between typical and worst-case travel times, and when does that variability occur?”*

**The agent handles the analysis end-to-end**, from understanding the question to exploring the data, running queries, and synthesizing findings.

![Screenshot showing a user asking which NYC taxi pickup→dropoff ZIP pairs are most “unreliable.” The agent explains using ~21k trips from samples.nyctaxi.trips, defines typical (p50) vs worst-case (p95), applies filters, and describes how it identifies when each ZIP pair’s longest trip occurred.](https://images.ctfassets.net/kftzwdyauwt9/4g30UoN8GBkdeUciQ6Wkra/cf30463db8033d5276d009bbe28ff06e/Desktop-Dark.png?w=3840&q=80&fm=webp)

The agent's response to the question.

One of the agent’s superpowers is how it reasons through problems. Rather than following a fixed script, the agent evaluates its own progress. If an intermediate result looks wrong (e.g., if it has zero rows due to an incorrect join or filter), the agent investigates what went wrong, adjusts its approach, and tries again. Throughout this process, it retains full context, and carries learnings forward between steps. This **closed-loop, self-learning process** shifts iteration from the user into the agent itself, enabling faster results and consistently higher-quality analyses than manual workflows.

![Screenshot of a task workflow showing an AI agent’s step-by-step plan for analyzing NYC taxi trip durations. It includes goals, internal searches, schema inspection, code snippets, and reasoning about computing p50/p95 spreads, identifying unreliable ZIP pairs, and planning SQL queries.](https://images.ctfassets.net/kftzwdyauwt9/2GRmgUjPOMpOAmkKfwQjVf/c0435b317be41c17ee759b44c93bca85/oai_in-house_data_agent_NYC_pickup-dropoff_pairs_dark.png?w=3840&q=80&fm=webp)

The agent’s reasoning to identify the most unreliable NYC taxi pickup–dropoff pairs.

The agent covers the full analytics workflow: discovering data, running SQL, and publishing notebooks and reports. It understands internal company knowledge, can web search for external information, and improves over time through learned usage and memory.

## Context is everything

High-quality answers depend on **rich, accurate context**. Without context, even strong models can produce wrong results, such as vastly misestimating user counts or misinterpreting internal terminology.

![Screenshot of a user asking, “What was ChatGPT Image Gen logged-in DAU for the last 30 days?” with a status line below showing the agent has been “Working for 22m 41s,” indicating a long-running query in progress.](https://images.ctfassets.net/kftzwdyauwt9/1pNJVVDpWr482m2aMKgOb9/e4ec222067060c58c1ebf05854378450/oai_in-house_data_agent_faster_queries_slow_desktop-dark.png?w=3840&q=80&fm=webp)

The agent without memory, unable to query effectively.

![Screenshot showing a user asking, “What was ChatGPT Image Gen logged-in DAU for the last 30 days?” Beneath the message, a status line says “Worked for 1m 22s,” indicating the query is still running and taking a long time to complete.](https://images.ctfassets.net/kftzwdyauwt9/1AlnC3YBUfUem8XzhNiQii/aedb368e0a9fb807712494da5fb3617c/oai_in-house_data_agent_faster_queries_fast_desktop-dark.png?w=3840&q=80&fm=webp)

The agent’s memory enables faster queries by locating the correct tables.

To avoid these failure modes, the agent is built around **multiple layers of context that ground it in OpenAI’s data and institutional knowledge.**

![Diagram titled “Data agent’s layers of context” showing six stacked tiers: 1) Table Usage, 2) Human Annotations, 3) Codex Enrichment, 4) Institutional Knowledge, 5) Memory, and 6) Runtime Context. Each layer appears as a horizontal bar in a pyramid shape.](https://images.ctfassets.net/kftzwdyauwt9/1e0UXiK99kqjFdEOipBUQM/12fd86e7463f04cf2d0f5bb1fdeced24/oai_in-house_data_agent_Layers_of_context_desktop-dark.svg?w=3840&q=80)

Diagram titled “Data agent’s layers of context” showing six stacked tiers: 1) Table Usage, 2) Human Annotations, 3) Codex Enrichment, 4) Institutional Knowledge, 5) Memory, and 6) Runtime Context. Each layer appears as a horizontal bar in a pyramid shape.

#### Layer #1: Table Usage

- **Metadata grounding:** The agent relies on schema metadata (column names and data types) to inform SQL writing and uses table lineage (e.g., upstream and downstream table relationships) to provide context on how different tables relate.
- **Query inference:** Ingesting historical queries helps the agent understand how to write its own queries and which tables are typically joined together.

- **Curated descriptions** of tables and columns provided by domain experts, capturing intent, semantics, business meaning, and known caveats that are not easily inferred from schemas or past queries.

Metadata alone isn’t enough. To really tell tables apart, you need to understand how they were created and where they originate.

- By deriving a code-level definition of a table, the agent builds a deeper understanding of what the data actually contains.
	- Nuances on what is stored in the table and how it is derived from an analytics event provides extra information. For example, it can give context on the uniqueness of values, how often the table data is updated, the scope of the data (e.g., if the table excludes certain fields, it has this level of granularity), etc.
- This provides enhanced usage context by showing how the table is used beyond SQL in Spark, Python, and other data systems.
- This means that the agent can distinguish between tables that look similar but differ in critical ways. For example, it can tell whether a table only includes first-party ChatGPT traffic. This context is also refreshed automatically, so it stays up to date without manual maintenance.

![Diagram titled “Codex-enriched knowledge pipeline.” Popular tables feed into multiple Codex tasks, which extract details from the OpenAI codebase, including a table’s purpose, grain and primary keys, downstream usage patterns, alternate table options, and data freshness.](https://images.ctfassets.net/kftzwdyauwt9/4vo6KqTVvFDJrzXwe947Aa/f9113ed440d61507a0468a788957b066/oai_in-house_data_agent_codex-enriched_knowledge_pipeline_desktop-dark.svg?w=3840&q=80)

Diagram titled “Codex-enriched knowledge pipeline.” Popular tables feed into multiple Codex tasks, which extract details from the OpenAI codebase, including a table’s purpose, grain and primary keys, downstream usage patterns, alternate table options, and data freshness.

- The agent can access Slack, Google Docs, and Notion, which capture critical company context such as launches, reliability incidents, internal codenames and tools, and the canonical definitions and computation logic for key metrics.
- These documents are ingested, embedded, and stored with metadata and permissions. A retrieval service handles access control and caching at runtime, enabling the agent to efficiently and safely pull in this information.

![Screenshot of a user asking why connector usage dipped in December. The agent explains the drop was due to a logging issue starting Nov 13, 2025, causing undercounted usage after the ChatGPT 5.1 launch. Legacy telemetry went empty until a newer event became the source of truth.](https://images.ctfassets.net/kftzwdyauwt9/6z6uxXjEI454qqphYu43UK/43042c9faf92fe45e21e6ceb82ca60bc/Desktop-Dark.png?w=3840&q=80&fm=webp)

Screenshot of a user asking why connector usage dipped in December. The agent explains the drop was due to a logging issue starting Nov 13, 2025, causing undercounted usage after the ChatGPT 5.1 launch. Legacy telemetry went empty until a newer event became the source of truth.

- When the agent is given corrections or discovers nuances about certain data questions, it's able to save these learnings for next time, allowing it to constantly improve with its users.
	- As a result, future answers begin from a more accurate baseline rather than repeatedly encountering the same issues.
		- The goal of memory is to retain and reuse non-obvious corrections, filters, and constraints that are critical for data correctness but difficult to infer from the other layers alone.
		- For example, in one case, the agent didn’t know how to filter for a particular analytics experiment (it relied on matching against a specific string defined in an experiment gate). Memory was crucially important here to ensure it was able to filter correctly, instead of fuzzily trying to string match.
- When you give the agent a correction or when it finds a learning from your conversation, it will prompt you to save that memory for next time.
	- Memories can also be manually created and edited by users.
		- Memories are scoped at the global and personal level, and the agent’s tooling makes it easy to edit them.

![Notification banner showing “Data agent wants to save 2 learnings to memory,” with a labeled item “ChatGPT Top-level Metrics” and a confirmation message on the right that reads “Saved to global memory” with a green checkmark.](https://images.ctfassets.net/kftzwdyauwt9/4wl8sFZO1MFveE2FZw7qvC/7e30e71979c8a43b800e5ed5716d0b2c/Desktop-Dark.png?w=3840&q=80&fm=webp)

Notification banner showing “Data agent wants to save 2 learnings to memory,” with a labeled item “ChatGPT Top-level Metrics” and a confirmation message on the right that reads “Saved to global memory” with a green checkmark.

- When no prior context exists for a table or when existing information is stale, the agent can issue live queries to the data warehouse to inspect and query the table directly. This allows it to validate schemas, understand the data in real-time, and respond accordingly.
- The agent is also able to talk to other Data Platform systems (metadata service, Airflow, Spark) as needed to get broader data context that exists outside the warehouse.

We run a daily offline pipeline that aggregates table usage, human annotations, and Codex-derived enrichment into a single, normalized representation. This enriched context is then converted into embeddings using the [OpenAI embeddings API ⁠](https://platform.openai.com/docs/api-reference/embeddings) and stored for retrieval. At query time, the agent pulls only the most relevant embedded context via [retrieval-augmented generation ⁠](https://en.wikipedia.org/wiki/Retrieval-augmented_generation) (RAG) instead of scanning raw metadata or logs. This makes table understanding fast and scalable, even across tens of thousands of tables, while keeping runtime latency predictable and low. Runtime queries are issued to our data warehouse live as needed.

![Diagram titled “Context retrieval in the data agent.” Offline preprocessing layers—table usage, human annotations, Codex enrichment, institutional knowledge, and memory—feed into RAG embeddings. Live retrieval shows the agent querying a database via semantic search or exact text retrieval to produce runtime context.](https://images.ctfassets.net/kftzwdyauwt9/u90x8VCsIVfWMACdsky6Y/cd3691359ca1e3aeb04b5cdfe1cd21d0/oai_in-house_data_agent_context_retrieval_desktop-dark.svg?w=3840&q=80)

Diagram titled “Context retrieval in the data agent.” Offline preprocessing layers—table usage, human annotations, Codex enrichment, institutional knowledge, and memory—feed into RAG embeddings. Live retrieval shows the agent querying a database via semantic search or exact text retrieval to produce runtime context.

Together, these layers ensure the agent’s reasoning is grounded in OpenAI’s data, code, and institutional knowledge, dramatically reducing errors and improving answer quality.

## Built to think and work like a teammate

One-shot answers work when the problem is clear, but most questions aren’t. More often, arriving at the correct result requires back-and-forth refinement and some course correction.

The agent is built to behave like a teammate you can reason with. It’s a conversational, always-on and handles both quick answers and iterative exploration.

It carries over complete context across turns, so users can ask follow-up questions, adjust their intent, or change direction without restating everything. If the agent starts heading down the wrong path, users can interrupt mid-analysis and redirect it, just like working with a human collaborator who listens instead of plowing ahead.

When instructions are unclear or incomplete, the agent proactively asks clarifying questions. If no response is provided, it applies sensible defaults to make progress. For example, if a user asks about business growth with no date range specified, it may assume the last seven or 30 days. These priors allow it to stay responsive and non-blocking while still converging on the right outcome.

The result is an agent that works well both when you know **exactly what you want** (e.g., “Tell me about this table”) and **just as strong when you’re exploring** (e.g., “I’m seeing a dip here, can we break this down by customer type and timeframe?”).

After rollout, we observed that users frequently ran the same analyses for routine repetitive work. To expedite this, the agent's workflows package recurring analyses into reusable instruction sets. Examples include workflows for weekly business reports and table validations. By encoding context and best practices once, workflows streamline repeat analyses and ensure consistent results across users.

![UI input bar with the placeholder text “Ask a data question.” Below it is a button labeled “Use a workflow,” and to the right are microphone and send icons. The bar has rounded corners and sits against a dark background.](https://images.ctfassets.net/kftzwdyauwt9/6jAwY8VgVCqHRbpEgdpA0Y/b5c8b3f6b949c048d00723132832a9d1/Desktop-Dark.png?w=3840&q=80&fm=webp)

UI input bar with the placeholder text “Ask a data question.” Below it is a button labeled “Use a workflow,” and to the right are microphone and send icons. The bar has rounded corners and sits against a dark background.

## Moving fast without breaking trust

Building an always-on, evolving agent means quality can drift just as easily as it can improve. Without a tight feedback loop, regressions are inevitable and invisible. The only way to scale capability without breaking trust is through systematic evaluation.

In this section, we’ll discuss how we leverage [OpenAI’s Evals API ⁠](https://platform.openai.com/docs/guides/evals) to measure and protect the agent’s response quality.

Its Evals are built on curated sets of question-answer pairs. Each question targets an important metric or analytical pattern we care deeply about getting right, paired with a manually authored “golden” SQL query that produces the expected result. For each eval, we send the natural language question to its query-generation endpoint, execute the generated SQL, and compare the output against the result of the expected SQL.

![Diagram titled “Data agent’s evaluation pipeline.” Q&A eval pairs with expected SQL feed into a generation step that produces SQL and results. OpenAI Evals compares generated vs. expected results using dataframe and SQL comparison, outputting a score and reasoning.](https://images.ctfassets.net/kftzwdyauwt9/15eSmOlfqTBZcxErAdzAbU/1dd9b1e550d1f9b3ed0e4c23dc662db2/oai_in-house_data_agent_eval_pipeline_desktop-dark.svg?w=3840&q=80)

Diagram titled “Data agent’s evaluation pipeline.” Q&A eval pairs with expected SQL feed into a generation step that produces SQL and results. OpenAI Evals compares generated vs. expected results using dataframe and SQL comparison, outputting a score and reasoning.

Evaluation doesn’t rely on naive string matching. Generated SQL can differ syntactically while still being correct, and result sets may include extra columns that don’t materially affect the answer. To account for this, we compare both the SQL and the resulting data, and feed these signals into OpenAI’s Evals grader. The grader produces a final score along with an explanation, capturing both correctness and acceptable variation.

These evals are like unit tests that run continuously during development to identify regressions as canaries in production; this allows us to catch issues early and confidently iterate as the agent's capabilities expand.

## Agent security

Our agent plugs directly into OpenAI’s existing security and access-control model. It operates purely as an interface layer, inheriting and enforcing the same permissions and guardrails that govern OpenAI’s data.

**All of the agent’s access is strictly** **pass-through**, meaning users can only query tables they already have permission to access. When access is missing, it flags this or falls back to alternative datasets the user is authorized to use.

Finally, it's built for transparency. Like any system, it can make mistakes. It **exposes its reasoning process** by summarizing assumptions and execution steps alongside each answer. When queries are executed, it links directly to the underlying results, allowing users to inspect raw data and verify every step of the analysis.

## Lessons learned

Building our agent from scratch surfaced practical lessons about how agents behave, where they struggle, and what actually makes them reliable at scale.

Early on, we exposed our full tool set to the agent, and quickly ran into problems with overlapping functionality. While this redundancy can be helpful for specific custom cases and is more obvious to a human when manually invoking, it’s confusing to agents. To reduce ambiguity and improve reliability, we restricted and consolidated certain tool calls.

We also discovered that highly prescriptive prompting degraded results. While many questions share a general analytical shape, the details vary enough that rigid instructions often pushed the agent down incorrect paths. By shifting to higher-level guidance and relying on GPT‑5’s reasoning to choose the appropriate execution path, the agent became more robust and produced better results.

Schemas and query history describe a table’s shape and usage, but its true meaning lives in the code that produces it. Pipeline logic captures assumptions, freshness guarantees, and business intent that never surface in SQL or metadata. By crawling the codebase with Codex, our agent understands how datasets are actually constructed and is able to better reason about what each table actually contains. It can answer “what’s in here” and “when can I use it” far more accurately than from warehouse signals alone.

## Same vision, new tools

We’re constantly working to improve our agent by increasing its ability to handle ambiguous questions, improving its reliability and accuracy with stronger validations, and integrating it more deeply into workflows. We believe it should blend naturally into how people already work, instead of functioning like a separate tool.

While our tooling will keep benefiting from underlying improvements in agent reasoning, validation, and self-correction, our team’s mission remains the same: seamlessly deliver fast, trustworthy data analysis across OpenAI’s data ecosystem.

- [2026](https://openai.com/news/?tags=2026)

## Author

Bonnie Xu, Aravind Suresh, Emma Tang

## Acknowledgements

Special thanks to the Data Productivity and Data Science teams, as well as to our many cross-functional users for their experimentation and feedback.
import { Logo } from '@/components/Logo';
import { GATEKEEPER_URL } from '@/utils/gatekeeper';
import {
	HOST_OPTIONS,
	hostChoiceReason,
	NEED_OPTIONS,
	PLAYER_OPTIONS,
	PLEX_ROUTE_OPTIONS,
	PREFERENCE_OPTIONS,
	preferenceChoiceReason,
	recommendSetup,
	SETUP_GUIDE_URL,
	SOURCE_OPTIONS,
	type Host,
	type Need,
	type Player,
	type PlexRoute,
	type Preference,
	type SetupAnswers,
	type SetupRecommendation,
	type SetupSource,
	type SetupSponsorBenefit,
	type SetupSponsorship,
} from '@/utils/setupQuestionnaire';
import { ArrowLeft, Check, Heart, RotateCcw } from 'lucide-react';
import type { NextPage } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

const INITIAL_ANSWERS: SetupAnswers = {
	player: 'unsure',
	sources: [],
	host: 'none',
	preference: 'unsure',
	needs: [],
};

type QuestionKey = 'player' | 'plexRoute' | 'sources' | 'host' | 'preference' | 'needs';

const QUESTION_HEADING_ID = 'setup-question-heading';

const QUESTION_TITLES: Record<QuestionKey, string> = {
	player: 'Where do you want to watch?',
	plexRoute: 'How should Plex get the library?',
	sources: 'What do you already have?',
	host: 'Can a machine stay on while you watch?',
	preference: 'How do you want to choose titles?',
	needs: 'Anything else that matters?',
};

const QUESTION_HINTS: Record<QuestionKey, string> = {
	player: 'Choose the app or kind of player you already use. You can change this later.',
	plexRoute: 'Keeping your existing Plex server and using rex are both supported routes.',
	sources:
		'Select the sources you want connected separately. If an addon already uses your debrid account, choose the addon alone unless you also want that account’s library connected separately.',
	host: 'A host is only needed for routes that run zurg, rex, arr or a media server.',
	preference:
		'Only the Sonarr/Radarr choice changes the route; a managed library can add Wanted notes and benefits.',
	needs: 'These answers add practical limits and optional next steps. You can skip this.',
};

function selectedClass(selected: boolean) {
	return selected
		? 'border-cyan-400 bg-cyan-900/40 text-white ring-1 ring-cyan-400'
		: 'border-gray-600 bg-gray-800/40 text-gray-200 hover:border-gray-400 hover:bg-gray-700/50';
}

function arrResetNotice(reason: string) {
	return `Automation with Sonarr/Radarr was reset to “I am not sure yet”. ${reason}`;
}

function sourcesAfterSelection(sources: SetupSource[], source: SetupSource): SetupSource[] {
	const selected = sources.includes(source);
	if (source === 'none') return selected ? [] : ['none'];
	return selected
		? sources.filter((current) => current !== source)
		: [...sources.filter((current) => current !== 'none'), source];
}

function ChoiceCard({
	label,
	description,
	selected,
	onClick,
	multi = false,
	disabled = false,
	disabledReason,
}: {
	label: string;
	description?: string;
	selected: boolean;
	onClick: () => void;
	multi?: boolean;
	disabled?: boolean;
	disabledReason?: string;
}) {
	return (
		<button
			type="button"
			role={multi ? undefined : 'radio'}
			aria-checked={multi ? undefined : selected}
			aria-pressed={multi ? selected : undefined}
			// aria-disabled, not disabled, keeps the card and its reason in the Tab order.
			aria-disabled={disabled}
			onClick={() => {
				if (disabled) return;
				onClick();
			}}
			className={`flex min-h-20 w-full flex-col items-start gap-1 rounded border-2 px-4 py-3 text-left transition-colors focus:ring-2 focus:ring-cyan-300 focus:outline-hidden aria-disabled:cursor-not-allowed aria-disabled:opacity-65 ${selectedClass(selected)}`}
		>
			<span className="flex w-full items-start justify-between gap-3 font-medium">
				<span>{label}</span>
				{selected ? (
					<Check className="h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />
				) : null}
			</span>
			{description ? <span className="text-xs text-gray-400">{description}</span> : null}
			{disabledReason ? (
				<span className="text-xs text-amber-200">Unavailable: {disabledReason}</span>
			) : null}
			{multi ? (
				<span className="text-[11px] text-gray-400">Select all that apply</span>
			) : null}
		</button>
	);
}

// Radio pattern: arrows move to and select the next/previous enabled card (wrapping); Tab stops stay.
function moveInRadioGroup(event: React.KeyboardEvent<HTMLElement>) {
	if (event.altKey || event.ctrlKey || event.metaKey) return;
	const radios = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
	const at = radios.indexOf(event.target as HTMLElement);
	const enabled = radios.filter((radio) => radio.getAttribute('aria-disabled') !== 'true');
	if (at < 0 || !enabled.length) return;
	const before = enabled.filter((radio) => radios.indexOf(radio) < at);
	const after = enabled.filter((radio) => radios.indexOf(radio) > at);
	const targets: Record<string, HTMLElement | undefined> = {
		ArrowRight: after[0] ?? enabled[0],
		ArrowDown: after[0] ?? enabled[0],
		ArrowLeft: before[before.length - 1] ?? enabled[enabled.length - 1],
		ArrowUp: before[before.length - 1] ?? enabled[enabled.length - 1],
		Home: enabled[0],
		End: enabled[enabled.length - 1],
	};
	const target = targets[event.key];
	if (!target) return;
	event.preventDefault();
	target.focus();
	target.click();
}

function answerLabel(key: QuestionKey, answers: SetupAnswers) {
	if (key === 'sources') {
		if (!answers.sources.length) return 'Nothing selected';
		return answers.sources
			.map(
				(source) =>
					SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source
			)
			.join(', ');
	}
	if (key === 'needs') {
		if (!answers.needs.length) return 'No extra needs';
		return answers.needs
			.map((need) => NEED_OPTIONS.find((option) => option.value === need)?.label ?? need)
			.join(', ');
	}
	if (key === 'plexRoute') {
		return (
			PLEX_ROUTE_OPTIONS.find((option) => option.value === answers.plexRoute)?.label ??
			'Not selected'
		);
	}
	if (key === 'player')
		return PLAYER_OPTIONS.find((option) => option.value === answers.player)?.label;
	if (key === 'host') return HOST_OPTIONS.find((option) => option.value === answers.host)?.label;
	return PREFERENCE_OPTIONS.find((option) => option.value === answers.preference)?.label;
}

function QuestionChoices({
	keyName,
	answers,
	setAnswers,
	hostAnswered,
	setHostAnswered,
	setCompatibilityNotice,
}: {
	keyName: QuestionKey;
	answers: SetupAnswers;
	setAnswers: React.Dispatch<React.SetStateAction<SetupAnswers>>;
	hostAnswered: boolean;
	setHostAnswered: React.Dispatch<React.SetStateAction<boolean>>;
	setCompatibilityNotice: React.Dispatch<React.SetStateAction<string | null>>;
}) {
	if (keyName === 'player') {
		return (
			<div
				role="radiogroup"
				onKeyDown={moveInRadioGroup}
				aria-labelledby={QUESTION_HEADING_ID}
				className="grid gap-3 sm:grid-cols-2"
			>
				{PLAYER_OPTIONS.map((option) => (
					<ChoiceCard
						key={option.value}
						label={option.label}
						description={option.description}
						selected={answers.player === option.value}
						onClick={() =>
							setAnswers((current) => ({
								...current,
								player: option.value as Player,
							}))
						}
					/>
				))}
			</div>
		);
	}

	if (keyName === 'plexRoute') {
		return (
			<div
				role="radiogroup"
				onKeyDown={moveInRadioGroup}
				aria-labelledby={QUESTION_HEADING_ID}
				className="grid gap-3"
			>
				{PLEX_ROUTE_OPTIONS.map((option) => (
					<ChoiceCard
						key={option.value}
						label={option.label}
						description={option.description}
						selected={answers.plexRoute === option.value}
						onClick={() =>
							setAnswers((current) => ({
								...current,
								plexRoute: option.value as PlexRoute,
							}))
						}
					/>
				))}
			</div>
		);
	}

	if (keyName === 'sources') {
		return (
			<div
				role="group"
				aria-labelledby={QUESTION_HEADING_ID}
				className="grid gap-3 sm:grid-cols-2"
			>
				{SOURCE_OPTIONS.map((option) => (
					<ChoiceCard
						key={option.value}
						label={option.label}
						description={option.description}
						selected={answers.sources.includes(option.value)}
						multi
						onClick={() =>
							setAnswers((current) => ({
								...current,
								sources: sourcesAfterSelection(
									current.sources,
									option.value as SetupSource
								),
							}))
						}
					/>
				))}
			</div>
		);
	}

	if (keyName === 'host') {
		return (
			<div
				role="radiogroup"
				onKeyDown={moveInRadioGroup}
				aria-labelledby={QUESTION_HEADING_ID}
				className="grid gap-3"
			>
				{HOST_OPTIONS.map((option) => {
					const disabledReason = hostChoiceReason(answers, option.value);
					return (
						<ChoiceCard
							key={option.value}
							label={option.label}
							description={option.description}
							selected={hostAnswered && answers.host === option.value}
							disabled={!!disabledReason}
							disabledReason={disabledReason}
							onClick={() => {
								setHostAnswered(true);
								setAnswers((current) => ({
									...current,
									host: option.value as Host,
								}));
							}}
						/>
					);
				})}
			</div>
		);
	}

	if (keyName === 'preference') {
		return (
			<div
				role="radiogroup"
				onKeyDown={moveInRadioGroup}
				aria-labelledby={QUESTION_HEADING_ID}
				className="grid gap-3 sm:grid-cols-2"
			>
				{PREFERENCE_OPTIONS.map((option) => {
					const disabledReason = preferenceChoiceReason(answers, option.value);
					return (
						<ChoiceCard
							key={option.value}
							label={option.label}
							description={option.description}
							selected={answers.preference === option.value}
							disabled={!!disabledReason}
							disabledReason={disabledReason}
							onClick={() => {
								setCompatibilityNotice(null);
								setAnswers((current) => ({
									...current,
									preference: option.value as Preference,
								}));
							}}
						/>
					);
				})}
			</div>
		);
	}

	return (
		<div
			role="group"
			aria-labelledby={QUESTION_HEADING_ID}
			className="grid gap-3 sm:grid-cols-2"
		>
			{NEED_OPTIONS.map((option) => (
				<ChoiceCard
					key={option.value}
					label={option.label}
					selected={answers.needs.includes(option.value)}
					multi
					onClick={() =>
						setAnswers((current) => {
							const needs = current.needs.includes(option.value)
								? current.needs.filter((need) => need !== option.value)
								: [...current.needs, option.value as Need];
							return { ...current, needs };
						})
					}
				/>
			))}
		</div>
	);
}

function ResultSection({ title, items }: { title: string; items: string[] }) {
	if (!items.length) return null;
	return (
		<section>
			<h3 className="mb-2 text-sm font-semibold tracking-wide text-cyan-200 uppercase">
				{title}
			</h3>
			<ul className="space-y-2 text-sm text-gray-200">
				{items.map((item) => (
					<li key={item} className="flex gap-2">
						<span className="mt-1 text-cyan-300" aria-hidden="true">
							•
						</span>
						<span>{item}</span>
					</li>
				))}
			</ul>
		</section>
	);
}

function SponsorBenefits({
	sponsorship,
	hasConflicts,
	hasSources,
	player,
}: {
	sponsorship: SetupSponsorship;
	hasConflicts: boolean;
	hasSources: boolean;
	player: Player;
}) {
	const benefitList = (benefits: SetupSponsorBenefit[]) => (
		<ul className="mt-2 space-y-2 text-sm text-gray-200">
			{benefits.map((benefit) => (
				<li key={benefit.id} className="flex gap-2">
					<span className="mt-1 text-pink-300" aria-hidden="true">
						•
					</span>
					<span>
						{benefit.href ? (
							<a
								href={benefit.href}
								target={benefit.href.startsWith('http') ? '_blank' : undefined}
								rel={
									benefit.href.startsWith('http')
										? 'noopener noreferrer'
										: undefined
								}
								className="text-pink-200 underline decoration-pink-400/60 underline-offset-2 hover:text-white"
							>
								{benefit.title}
							</a>
						) : (
							<strong className="font-medium text-gray-100">{benefit.title}</strong>
						)}{' '}
						<span className="text-gray-400">{benefit.detail}</span>
					</span>
				</li>
			))}
		</ul>
	);

	return (
		<section
			data-testid="sponsorship-section"
			className="rounded border-2 border-pink-500/40 bg-pink-950/20 p-4 sm:p-5"
		>
			<div className="flex items-center gap-2">
				<Heart className="h-4 w-4 text-pink-300" aria-hidden="true" />
				<h3 className="text-sm font-semibold tracking-wide text-pink-200 uppercase">
					Sponsor DMM for these benefits
				</h3>
			</div>
			<p className="mt-2 text-sm leading-6 text-gray-300">
				{sponsorship.routeAvailable
					? sponsorship.required.length
						? 'Sponsor DMM to unlock the required integrations below, then use the linked setup pages.'
						: sponsorship.usesDmmTools
							? sponsorship.optional.some(
									({ id }) => id !== 'sponsor-benefits' && id !== 'discord-role'
								)
								? 'Sponsorship is optional for the free tools in this setup. Sponsor DMM for the upgrades below.'
								: 'Sponsorship is optional for the free tools in this setup.'
							: sponsorship.hasAccount
								? 'Sponsorship is optional here; the benefits below are for your accounts or other routes.'
								: 'Sponsorship is optional here.'
					: hasConflicts
						? 'Resolve the setup requirements above first. Sponsorship does not remove them.'
						: hasSources
							? 'Choose a source your player supports first; DMM has no route for the selected sources with this player.'
							: 'Choose a source first.'}
			</p>
			<a
				href={GATEKEEPER_URL}
				target="_blank"
				rel="noopener noreferrer"
				data-testid="sponsor-primary-cta"
				className="mt-3 inline-flex items-center justify-center rounded border-2 border-pink-300 bg-pink-500/20 px-4 py-2 text-sm font-semibold text-pink-100 hover:bg-pink-500/40"
			>
				Sponsor DMM
			</a>
			<p className="mt-2 text-xs text-gray-400">
				Already sponsoring?{' '}
				<Link
					href="/settings"
					className="text-pink-200 underline underline-offset-2 hover:text-white"
				>
					Connect your key in DMM settings
				</Link>
			</p>
			{sponsorship.freeFeatures.includes('cast') ? (
				<p className="mt-2 text-xs text-gray-400">
					{player === 'kodi'
						? 'The Kodi addon does not'
						: player === 'stremio'
							? 'DMM Cast does not'
							: 'DMM Cast and the Kodi addon do not'}{' '}
					require sponsorship; sponsoring lets you raise the per-profile limit from five
					to ten other streams.
				</p>
			) : null}
			{sponsorship.freeFeatures.includes('rex') ? (
				<p className="mt-2 text-xs text-gray-400">
					{sponsorship.freeFeatures.includes('rex-stremio')
						? 'rex and rex-stremio do not'
						: 'rex does not'}{' '}
					require sponsorship; any sponsor benefits below apply to the zurg,{' '}
					{sponsorship.freeFeatures.includes('rex-stremio') ? 'rex-stremio, ' : ''}API or
					help parts of the setup.
				</p>
			) : null}
			{sponsorship.required.length ? (
				<div className="mt-4">
					<h4 className="text-sm font-medium text-pink-100">Required for this route</h4>
					{benefitList(sponsorship.required)}
				</div>
			) : null}
			<div className="mt-4">
				<h4 className="text-sm font-medium text-pink-100">
					{sponsorship.required.length
						? 'Also included or useful'
						: 'Optional sponsor benefits'}
				</h4>
				{benefitList(sponsorship.optional)}
			</div>
		</section>
	);
}

function RecommendationView({
	recommendation,
	answers,
	questionKeys,
	onEdit,
	onReset,
	resultHeadingRef,
}: {
	recommendation: SetupRecommendation;
	answers: SetupAnswers;
	questionKeys: QuestionKey[];
	onEdit: (key: QuestionKey) => void;
	onReset: () => void;
	resultHeadingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
	return (
		<div className="flex flex-col gap-5">
			<div className="rounded border-2 border-cyan-400/60 bg-cyan-950/30 p-4 sm:p-5">
				<p className="text-xs font-semibold tracking-wide text-cyan-200 uppercase">
					Your starting route
				</p>
				<h2
					ref={resultHeadingRef}
					tabIndex={-1}
					className="mt-1 text-2xl font-bold text-white focus:outline-hidden"
				>
					{recommendation.primaryRoute.title}
				</h2>
				<p className="mt-2 text-sm leading-6 text-gray-200">
					{recommendation.primaryRoute.summary}
				</p>
			</div>

			{recommendation.conflicts.length ? (
				<section className="rounded border-2 border-amber-400/60 bg-amber-950/30 p-4">
					<h3 className="text-sm font-semibold tracking-wide text-amber-200 uppercase">
						A constraint to resolve
					</h3>
					<ResultSection title="What needs changing" items={recommendation.conflicts} />
				</section>
			) : null}

			<SponsorBenefits
				sponsorship={recommendation.sponsorship}
				hasConflicts={recommendation.conflicts.length > 0}
				hasSources={recommendation.sourceCoverage.length > 0}
				player={answers.player}
			/>

			<div className="grid gap-5 rounded border border-gray-700 bg-gray-800/30 p-4 sm:grid-cols-2 sm:p-5">
				<ResultSection title="Why this matched" items={recommendation.whyMatched} />
				<ResultSection title="What it includes" items={recommendation.components} />
				<ResultSection title="Before you start" items={recommendation.prerequisites} />
				<ResultSection title="Limits to know" items={recommendation.limits} />
				<ResultSection title="Source notes" items={recommendation.sourceNotes} />
				<ResultSection
					title="How each source fits"
					items={recommendation.sourceCoverage.map((coverage) =>
						[
							// A route title has no period; a separate route's summary already ends with one.
							`${coverage.label}: ${coverage.integration.replace(/\.?$/, '.')}`,
							...coverage.requirements,
						].join(' ')
					)}
				/>
				<ResultSection title="Useful for your needs" items={recommendation.optionalNeeds} />
			</div>

			<section className="rounded border border-gray-700 bg-gray-800/30 p-4 sm:p-5">
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-cyan-200 uppercase">
					Setup steps
				</h3>
				<div className="flex flex-col items-start gap-2">
					{recommendation.setupLinks.map((link) => (
						<a
							key={link.href}
							href={link.href}
							target={link.href.startsWith('http') ? '_blank' : undefined}
							rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
							className="text-sm text-cyan-200 underline decoration-cyan-400/60 underline-offset-2 hover:text-white"
						>
							{link.label}
						</a>
					))}
				</div>
			</section>

			{recommendation.alternatives.length ? (
				<section className="rounded border border-gray-700 bg-gray-800/30 p-4 sm:p-5">
					<h3 className="mb-3 text-sm font-semibold tracking-wide text-cyan-200 uppercase">
						Relevant alternatives
					</h3>
					<div className="space-y-4">
						{recommendation.alternatives.map((alternative) => (
							<div key={alternative.title}>
								<h4 className="font-medium text-gray-100">{alternative.title}</h4>
								<p className="mt-1 text-sm text-gray-400">{alternative.detail}</p>
								<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
									{alternative.links.map((link) => (
										<a
											key={link.href}
											href={link.href}
											target={
												link.href.startsWith('http') ? '_blank' : undefined
											}
											rel={
												link.href.startsWith('http')
													? 'noopener noreferrer'
													: undefined
											}
											className="text-sm text-cyan-200 underline underline-offset-2 hover:text-white"
										>
											{link.label}
										</a>
									))}
								</div>
							</div>
						))}
					</div>
				</section>
			) : null}

			<section className="rounded border border-gray-700 bg-gray-800/30 p-4 sm:p-5">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h3 className="text-sm font-semibold tracking-wide text-cyan-200 uppercase">
						Your answers
					</h3>
					<button
						type="button"
						onClick={onReset}
						className="inline-flex items-center gap-1.5 rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
					>
						<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
						Reset
					</button>
				</div>
				<div className="mt-3 divide-y divide-gray-700/70">
					{questionKeys.map((key) => (
						<div
							key={key}
							className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
						>
							<div className="min-w-0">
								<div className="text-xs text-gray-400">{QUESTION_TITLES[key]}</div>
								<div className="text-sm break-words text-gray-200">
									{answerLabel(key, answers)}
								</div>
							</div>
							<button
								type="button"
								onClick={() => onEdit(key)}
								className="shrink-0 rounded border border-gray-600 px-3 py-1.5 text-xs text-cyan-200 hover:bg-gray-700"
								aria-label={`Edit ${QUESTION_TITLES[key]}`}
							>
								Edit
							</button>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}

const ChooseYourSetupPage: NextPage & { disableLibraryProvider?: boolean } = () => {
	const [answers, setAnswers] = useState<SetupAnswers>(INITIAL_ANSWERS);
	const [hostAnswered, setHostAnswered] = useState(false);
	const [compatibilityNotice, setCompatibilityNotice] = useState<string | null>(null);
	const [currentStep, setCurrentStep] = useState(0);
	const [submitted, setSubmitted] = useState(false);
	const questionHeadingRef = useRef<HTMLHeadingElement>(null);
	const resultHeadingRef = useRef<HTMLHeadingElement>(null);

	const questionKeys = useMemo<QuestionKey[]>(
		() =>
			answers.player === 'plex'
				? ['player', 'plexRoute', 'sources', 'host', 'preference', 'needs']
				: ['player', 'sources', 'host', 'preference', 'needs'],
		[answers.player]
	);

	useEffect(() => {
		setCurrentStep((step) => Math.min(step, questionKeys.length - 1));
	}, [questionKeys.length]);

	// Focus follows a later step or result change, never the first render, so Tab starts at the top.
	const focusedView = useRef(`${currentStep}:${submitted}`);
	useEffect(() => {
		const view = `${currentStep}:${submitted}`;
		if (focusedView.current === view) return;
		focusedView.current = view;
		if (submitted) resultHeadingRef.current?.focus();
		else questionHeadingRef.current?.focus();
	}, [currentStep, submitted]);

	const recommendation = submitted ? recommendSetup(answers) : null;
	const currentQuestion = questionKeys[currentStep];
	const currentHasAnswer =
		currentQuestion === 'sources'
			? answers.sources.length > 0
			: currentQuestion === 'host'
				? hostAnswered
				: currentQuestion === 'plexRoute'
					? !!answers.plexRoute
					: true;
	const isLastStep = currentStep === questionKeys.length - 1;

	function reset() {
		setAnswers(INITIAL_ANSWERS);
		setHostAnswered(false);
		setCompatibilityNotice(null);
		setCurrentStep(0);
		setSubmitted(false);
	}

	function submit(event: FormEvent) {
		event.preventDefault();
		if (!currentHasAnswer) return;
		if (!isLastStep) {
			// Dropped on leaving the sources step, which the host step follows, so passing through a
			// player or source that rules Android out keeps it; the host is then asked again.
			const dropAndroid =
				currentQuestion === 'sources' &&
				answers.host === 'android' &&
				!!hostChoiceReason(answers, 'android');
			if (dropAndroid) {
				setHostAnswered(false);
				setAnswers((current) => ({ ...current, host: 'none' }));
			}
			// Judged on leaving the step, so passing through an invalid pick (untick one debrid, tick another) keeps arr.
			if (currentQuestion === 'sources' || currentQuestion === 'host') {
				const resetReason =
					answers.preference === 'arr'
						? preferenceChoiceReason(
								// The host step still follows sources, so only the sources can rule arr out here.
								currentQuestion === 'sources'
									? { host: 'existing', sources: answers.sources }
									: answers,
								'arr'
							)
						: undefined;
				// Only a reset sets the notice. It stays through later steps until arr is
				// allowed again, judged on the host too once it has been answered, and gives
				// the reason that rules arr out now, as the disabled arr card does.
				if (resetReason) {
					setCompatibilityNotice(arrResetNotice(resetReason));
					setAnswers((current) => ({ ...current, preference: 'unsure' }));
				} else {
					const reason = preferenceChoiceReason(
						hostAnswered && !dropAndroid
							? answers
							: { host: 'existing', sources: answers.sources },
						'arr'
					);
					setCompatibilityNotice((notice) =>
						notice && reason ? arrResetNotice(reason) : null
					);
				}
			}
			setCurrentStep((step) => step + 1);
			return;
		}
		setCompatibilityNotice(null);
		setSubmitted(true);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	// submit cleared the notice on the way to the result, the only view that offers Edit.
	function edit(key: QuestionKey) {
		setSubmitted(false);
		setCurrentStep(questionKeys.indexOf(key));
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	return (
		<div className="min-h-screen bg-gray-900 px-4 py-6 text-gray-100 sm:py-10">
			<Head>
				<title>Debrid Media Manager - Choose your setup</title>
			</Head>
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-10">
				<Link
					href="/"
					className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-100"
				>
					<ArrowLeft className="h-4 w-4" aria-hidden="true" />
					<Logo className="h-6 w-6" />
					<span>Back to dashboard</span>
				</Link>

				<header>
					<h1 className="text-3xl font-bold text-white">Choose your setup</h1>
					<p className="mt-2 max-w-2xl text-sm leading-6 text-gray-300">
						Answer a few plain-language questions and get a route that matches the
						player, sources and host you actually have. You can combine sources, and you
						do not need every part of the stack.
					</p>
					<a
						href={SETUP_GUIDE_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="mt-3 inline-block text-sm text-cyan-200 underline underline-offset-2 hover:text-white"
					>
						Read the full setup guide
					</a>
				</header>

				{recommendation ? (
					<RecommendationView
						recommendation={recommendation}
						answers={answers}
						questionKeys={questionKeys}
						onEdit={edit}
						onReset={reset}
						resultHeadingRef={resultHeadingRef}
					/>
				) : (
					<form
						onSubmit={submit}
						className="flex flex-col gap-5"
						aria-label="Setup questionnaire"
					>
						<section className="rounded border-2 border-gray-600 bg-gray-800/30 p-4 sm:p-5">
							<div className="mb-5 flex items-center justify-between gap-3">
								<div>
									<p className="text-xs font-semibold tracking-wide text-cyan-200 uppercase">
										Question {currentStep + 1} of {questionKeys.length}
									</p>
									<div
										role="progressbar"
										aria-label="Questionnaire progress"
										aria-valuemin={1}
										aria-valuemax={questionKeys.length}
										aria-valuenow={currentStep + 1}
										aria-valuetext={`Question ${currentStep + 1} of ${questionKeys.length}`}
										className="mt-2 h-1.5 w-36 overflow-hidden rounded bg-gray-700 sm:w-56"
									>
										<span
											className="block h-full rounded bg-cyan-400 transition-all"
											style={{
												width: `${((currentStep + 1) / questionKeys.length) * 100}%`,
											}}
										/>
									</div>
								</div>
								<button
									type="button"
									onClick={reset}
									className="inline-flex items-center gap-1.5 rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
								>
									<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
									Reset
								</button>
							</div>

							<h2
								id={QUESTION_HEADING_ID}
								ref={questionHeadingRef}
								tabIndex={-1}
								className="text-2xl font-bold text-white focus:outline-hidden"
							>
								{QUESTION_TITLES[currentQuestion]}
							</h2>
							<p className="mt-2 mb-5 text-sm text-gray-400">
								{QUESTION_HINTS[currentQuestion]}
							</p>
							<QuestionChoices
								keyName={currentQuestion}
								answers={answers}
								setAnswers={setAnswers}
								hostAnswered={hostAnswered}
								setHostAnswered={setHostAnswered}
								setCompatibilityNotice={setCompatibilityNotice}
							/>
							{compatibilityNotice ? (
								<p
									role="status"
									aria-live="polite"
									className="mt-4 rounded border border-amber-400/60 bg-amber-950/30 p-3 text-sm text-amber-100"
								>
									{compatibilityNotice}
								</p>
							) : null}
						</section>

						<div className="flex flex-wrap justify-between gap-3">
							<button
								type="button"
								disabled={currentStep === 0}
								onClick={() => setCurrentStep((step) => Math.max(0, step - 1))}
								className="rounded border-2 border-gray-600 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
							>
								Back
							</button>
							<button
								type="submit"
								disabled={!currentHasAnswer}
								className="rounded border-2 border-gray-500 bg-gray-700 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-600 disabled:cursor-not-allowed disabled:border-gray-600 disabled:bg-gray-800 disabled:text-gray-500"
							>
								{isLastStep ? 'See my setup' : 'Next'}
							</button>
						</div>
					</form>
				)}
			</div>
		</div>
	);
};

ChooseYourSetupPage.disableLibraryProvider = true;

export default ChooseYourSetupPage;

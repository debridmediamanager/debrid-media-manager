// @vitest-environment node
import tsParser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from './no-deprecated.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
	languageOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module',
		parserOptions: { ecmaFeatures: { jsx: true } },
	},
	settings: { react: { version: '19.1.1' } },
});
const errors = (count = 1) => Array.from({ length: count }, () => ({ messageId: 'deprecated' }));

tester.run('react/no-deprecated', rule, {
	valid: [
		'React.createElement("p", {}, null); React.cloneElement(element);',
		'ReactDOM.findDOMNode(instance); ReactDOM.createPortal(child, container);',
		'ReactDOMServer.renderToString(element); ReactDOMServer.renderToStaticMarkup(element);',
		'import {createRoot, hydrateRoot} from "react-dom/client"; const root = createRoot(container); root.unmount();',
		'import {renderToPipeableStream} from "react-dom/server";',
		'const {renderToString} = require("react-dom/server");',
		'const {default: defaultReactExport, ...rest} = React;',
		'class NotReact { componentWillMount() {} componentWillReceiveProps() {} componentWillUpdate() {} }',
		'const plain = { componentWillMount() {}, componentWillReceiveProps() {}, componentWillUpdate() {} };',
		'createReactClassNonReact({componentWillMount() {}});',
		'class C extends React.Component { UNSAFE_componentWillMount() {} }',
		{ code: 'React.renderComponent();', settings: { react: { version: '0.11.0' } } },
		{ code: 'React.createClass();', settings: { react: { version: '15.4.0' } } },
		{
			code: 'class C extends React.Component { componentWillMount() {} }',
			settings: { react: { version: '16.8.0' } },
		},
		{
			code: 'import {render, hydrate} from "react-dom"; ReactDOM.render(element, container); ReactDOMServer.renderToNodeStream(element);',
			settings: { react: { version: '17.999.999' } },
		},
	],
	invalid: [
		...[
			'React.renderComponent()',
			'React.renderComponentToString()',
			'React.renderComponentToStaticMarkup()',
			'React.isValidComponent()',
			'React.isValidClass()',
			'this.transferPropsTo()',
			'React.addons.classSet()',
			'React.addons.cloneWithProps()',
			'React.render(element, container)',
			'React.unmountComponentAtNode(container)',
			'React.findDOMNode(instance)',
			'React.renderToString(element)',
			'React.renderToStaticMarkup(element)',
			'React.addons.LinkedStateMixin',
			'ReactPerf.printDOM()',
			'Perf.printDOM()',
			'ReactPerf.getMeasurementsSummaryMap()',
			'Perf.getMeasurementsSummaryMap()',
			'React.createClass({})',
			'React.addons.TestUtils',
			'React.PropTypes',
			'React.DOM.div',
			'ReactDOM.hydrate(element, container)',
			'ReactDOM.unmountComponentAtNode(container)',
			'ReactDOMServer.renderToNodeStream(element)',
		].map((code) => ({ code, errors: errors() })),
		{ code: 'React.PropTypes.component; React.PropTypes.renderable;', errors: errors(4) },
		{ code: 'Foo.renderComponent()', settings: { react: { pragma: 'Foo' } }, errors: errors() },
		{ code: '/** @jsx Foo */ Foo.renderComponent()', errors: errors() },
		{ code: 'import {createClass, PropTypes} from "react";', errors: errors(2) },
		{ code: 'const {createClass, PropTypes} = require("react");', errors: errors(2) },
		{ code: 'const {createClass, PropTypes} = React;', errors: errors(2) },
		{
			code: 'import {printDOM} from "react-addons-perf"; const {getMeasurementsSummaryMap} = Perf;',
			errors: errors(2),
		},
		{
			code: 'import {render, hydrate, unmountComponentAtNode} from "react-dom"; import {renderToNodeStream} from "react-dom/server";',
			errors: errors(4),
		},
		{
			code: 'const {render, hydrate} = require("react-dom"); const {renderToNodeStream} = ReactDOMServer;',
			errors: errors(3),
		},
		...['React.Component', 'React.PureComponent', 'Component', 'PureComponent'].map((base) => ({
			code: `class C extends ${base} { componentWillMount() {} componentWillReceiveProps() {} componentWillUpdate() {} }`,
			errors: errors(3),
		})),
		{
			code: 'const C = class extends React.Component { componentWillMount() {} };',
			errors: errors(),
		},
		{
			code: 'createReactClass({componentWillMount() {}, componentWillReceiveProps() {}, componentWillUpdate() {}});',
			errors: errors(3),
		},
		{ code: 'React.createReactClass({componentWillMount() {}});', errors: errors() },
		{
			code: 'customClass({componentWillMount() {}});',
			settings: { react: { createClass: 'customClass' } },
			errors: errors(),
		},
		{
			code: '/** @extends React.Component */ class C extends Base { componentWillMount() {} }',
			errors: errors(),
		},
		{
			code: '/** @augments {React.PureComponent} */ export default class C extends Base { componentWillUpdate() {} }',
			errors: errors(),
		},
		{
			code: 'class C extends React.Component { componentWillMount = () => {}; }',
			languageOptions: { parser: tsParser },
			errors: errors(),
		},
		{
			code: 'ReactDOM.render(element, container)',
			errors: [
				{
					messageId: 'deprecated',
					data: {
						oldMethod: 'ReactDOM.render',
						version: '18.0.0',
						newMethod: ', use createRoot instead',
						refs: ', see https://reactjs.org/link/switch-to-createroot',
					},
				},
			],
		},
	],
});
